// lib/bulk-email/recipient-store.ts
//
// Writing recipients for a send, cleaning up abandoned uploads, and the
// one-time move of older sends whose recipients were stored inside the
// job document.

import { Types } from "mongoose";
import { BulkEmailJob, EMPTY_COUNTS, type JobCounts } from "../models/BulkEmailJob";
import { BulkRecipient } from "../models/BulkRecipient";
import { isValidEmail, MAX_RECIPIENTS_PER_JOB } from "./recipients";

export interface IncomingRecipient {
  email?: string;
  name?: string;
  vars?: Record<string, unknown>;
}

/** Validates and cleans one upload batch (never trust the browser's parse). */
export function cleanRecipients(input: IncomingRecipient[]) {
  const seen = new Set<string>();
  const out: { email: string; name?: string; vars: Record<string, string> }[] = [];
  for (const r of input) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (!isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.vars ?? {})) {
      if (/^[a-z0-9_]{1,64}$/.test(k)) vars[k] = String(v ?? "").slice(0, 1000);
    }
    out.push({ email, name: r.name?.trim().slice(0, 200) || undefined, vars });
  }
  return out;
}

/** Adds a batch to a "preparing" send. Addresses already in the send
 * (from an earlier batch) are skipped. Returns how many were added. */
export async function addRecipients(jobId: Types.ObjectId, workspaceId: string, batch: ReturnType<typeof cleanRecipients>) {
  if (batch.length === 0) return { added: 0, total: 0 };

  // Reserve a block of positions atomically, so concurrent batches never
  // collide on `index`.
  const reserved = await BulkEmailJob.findOneAndUpdate(
    { _id: jobId, status: "preparing", "counts.total": { $lte: MAX_RECIPIENTS_PER_JOB - batch.length } },
    { $inc: { "counts.total": batch.length } },
    { projection: { counts: 1 } }
  );
  if (!reserved) {
    throw new Error(`A single send is limited to ${MAX_RECIPIENTS_PER_JOB.toLocaleString()} recipients.`);
  }
  const base = reserved.counts.total;

  let added = batch.length;
  try {
    await BulkRecipient.insertMany(
      batch.map((r, i) => ({ jobId, workspaceId, index: base + i, ...r, status: "pending" })),
      { ordered: false }
    );
  } catch (err) {
    // Duplicate addresses across batches hit the (jobId, email) unique
    // index; everything else in the batch is still inserted.
    // Mongoose copies each driver WriteError into a plain object, which
    // drops its `code` getter -- the code survives under `err.code`.
    const e = err as { insertedDocs?: unknown[]; writeErrors?: { code?: number; err?: { code?: number } }[] };
    const writeErrors = e.writeErrors ?? [];
    const allDuplicates = writeErrors.length > 0 && writeErrors.every((w) => (w.code ?? w.err?.code) === 11000);
    if (!allDuplicates || !Array.isArray(e.insertedDocs)) throw err;
    added = e.insertedDocs.length;
  }
  if (added !== batch.length) {
    // Positions reserved for duplicates stay unused; only the count is fixed.
    await BulkEmailJob.updateOne({ _id: jobId }, { $inc: { "counts.total": added - batch.length } });
  }
  const job = await BulkEmailJob.findById(jobId).select("counts.total").lean();
  return { added, total: job?.counts.total ?? 0 };
}

/** Deletes sends whose recipient upload never finished (browser closed
 * mid-upload) after a day. */
export async function cleanupAbandonedUploads() {
  const stale = await BulkEmailJob.find({ status: "preparing", createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }).select("_id");
  for (const { _id } of stale) {
    await BulkRecipient.deleteMany({ jobId: _id });
    await BulkEmailJob.deleteOne({ _id, status: "preparing" });
  }
}

interface LegacyRecipient {
  email: string;
  name?: string;
  vars?: Record<string, string>;
  status: string;
  openedAt?: Date;
  clickedAt?: Date;
  deliveryIssue?: string;
  [key: string]: unknown;
}

/** Moves recipients of sends created before the BulkRecipient collection
 * out of the job document. Keeps each recipient's index (tracking links
 * in delivered emails depend on it). Idempotent and safe to run on every
 * server start: only touches jobs that still hold an embedded array. */
export async function migrateEmbeddedRecipients(): Promise<number> {
  const jobs = BulkEmailJob.collection.find({ "recipients.0": { $exists: true } }, { projection: { workspaceId: 1, recipients: 1 } });
  let moved = 0;
  for await (const job of jobs) {
    const recipients = (job.recipients ?? []) as LegacyRecipient[];
    const counts: JobCounts = { ...EMPTY_COUNTS, total: recipients.length };
    const ops = recipients.map((r, index) => {
      if (r.status === "sent" || r.status === "failed" || r.status === "skipped") counts[r.status]++;
      if (r.openedAt) counts.opened++;
      if (r.clickedAt) counts.clicked++;
      if (r.deliveryIssue === "bounced" || r.deliveryIssue === "soft_bounced") counts.bounced++;
      if (r.deliveryIssue === "complained") counts.complained++;
      const { variant: _variant, ...rest } = r;
      return {
        updateOne: {
          filter: { jobId: job._id, index },
          // jobId and index come from the filter on insert.
          update: { $setOnInsert: { ...rest, workspaceId: job.workspaceId } },
          upsert: true,
        },
      };
    });
    for (let i = 0; i < ops.length; i += 1000) {
      await BulkRecipient.collection.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }
    await BulkEmailJob.collection.updateOne({ _id: job._id }, { $set: { counts }, $unset: { recipients: "", abTest: "" } });
    moved++;
  }
  // Older sends that had no recipients array at all still need counts.
  await BulkEmailJob.collection.updateMany({ counts: { $exists: false } }, { $set: { counts: { ...EMPTY_COUNTS } } });
  // A/B testing was removed; any send left waiting on it just completes.
  await BulkEmailJob.collection.updateMany({ status: "testing" }, { $set: { status: "completed", completedAt: new Date() } });
  return moved;
}
