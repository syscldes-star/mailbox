// lib/bulk-email/process-job.ts
//
// The background worker that actually delivers a bulk job. Started via
// waitUntil() right after the job is created, and restarted on demand
// (resumeStaleJobs) if the process that was running it died mid-send --
// e.g. a pm2 restart during a deploy. Progress is written per recipient,
// so a restarted worker just carries on with whoever is still "pending";
// nobody is emailed twice.

import { waitUntil } from "@vercel/functions";
import { connectToDatabase } from "../db/mongodb";
import { BulkEmailJob, incCounts, type JobCounts } from "../models/BulkEmailJob";
import { BulkRecipient, type IBulkRecipient } from "../models/BulkRecipient";
import { EmailSuppression } from "../models/EmailSuppression";
import { sendEmail, SendError, type OutgoingEmail } from "./sender";
import { htmlToText, renderTemplate, withFooter, withPreheader } from "./template";
import { unsubscribeUrl } from "./unsubscribe";
import { loadAttachmentData } from "./attachments";
import { signSignupLinks } from "./subscribe";
import { addUtmTags, clickTrackingUrl, openPixelUrl, rewriteLinks, withOpenPixel, type UtmTags } from "./tracking";

const CONCURRENCY = Math.max(1, Number(process.env.BULK_EMAIL_CONCURRENCY) || 5);
const RATE_PER_SECOND = Math.max(1, Number(process.env.BULK_EMAIL_RATE_PER_SECOND) || 10);
/** When Oracle's per-minute limit is hit, wait this long and try again
 * (up to MAX_RATE_PAUSES times for one email) instead of failing it. */
const RATE_PAUSE_MS = 61_000;
const MAX_RATE_PAUSES = 30;
const MAX_ATTEMPTS = 3;
/** Recipients loaded per database round trip. */
const BATCH_SIZE = 500;
/** A "sending" job not touched for this long is assumed orphaned. Must
 * comfortably exceed the slowest single send including retries. */
export const HEARTBEAT_STALE_MS = 2 * 60_000;

const SKIP_REASON: Record<string, string> = {
  unsubscribed: "Unsubscribed",
  bounced: "Bounced on an earlier send",
  complained: "Marked an earlier email as spam",
  manual: "On your do-not-email list",
  inactive: "Inactive -- stopped after no opens or clicks",
};

export interface MessageSource {
  workspaceId: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  preheader?: string;
  bodyHtml: string;
  publicBaseUrl: string;
  postalAddress?: string;
  utm?: UtmTags;
}

/** Renders the job's template for one recipient. Shared with the
 * "send test" route so a test email matches the real thing exactly. */
export function buildMessage(
  source: MessageSource,
  recipient: { email: string; name?: string; vars?: Record<string, string> },
  tracking: { openPixel?: string; wrapLink?: (url: string) => string; jobId?: string } = {}
): OutgoingEmail {
  const unsubscribe = unsubscribeUrl(source.publicBaseUrl, source.workspaceId, recipient.email, tracking.jobId);
  const vars = { ...(recipient.vars ?? {}), email: recipient.email, name: recipient.name ?? "", unsubscribe_url: unsubscribe };
  const rendered = signSignupLinks(
    renderTemplate(withPreheader(withFooter(source.bodyHtml, source.postalAddress), source.preheader), vars, { html: true }),
    source.publicBaseUrl,
    recipient.email
  );
  // Links are tagged and wrapped after rendering so merge tags inside
  // URLs are already filled in; the unsubscribe link is never touched.
  // UTM tags go on first, so the click redirect lands on the tagged URL.
  const isUnsubscribe = (url: string) => url === unsubscribe;
  // Campaign tags are for the sender's own website analytics, so links
  // into this app (e.g. an inserted signup form) are left untagged --
  // nothing reads them there, and click tracking already counts them.
  const appBase = `${source.publicBaseUrl.replace(/\/+$/, "")}/api/`;
  const skipUtm = (url: string) => isUnsubscribe(url) || url.startsWith(appBase);
  const tagged = source.utm ? rewriteLinks(rendered, (url) => addUtmTags(url, source.utm!), skipUtm) : rendered;
  const linked = tracking.wrapLink ? rewriteLinks(tagged, tracking.wrapLink, isUnsubscribe) : tagged;
  const html = tracking.openPixel ? withOpenPixel(linked, tracking.openPixel) : linked;
  return {
    from: { email: `${source.fromLocalPart}@${source.fromDomain}`, name: source.fromName },
    to: { email: recipient.email, name: recipient.name },
    replyTo: source.replyTo,
    subject: renderTemplate(source.subject, vars, { html: false }),
    bodyHtml: html,
    bodyText: htmlToText(html),
    unsubscribeUrl: unsubscribe,
  };
}

async function sendWithRetry(message: OutgoingEmail, onPause?: () => Promise<void>) {
  let pauses = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendEmail(message);
    } catch (err) {
      // Per-minute limit: not this email's fault -- wait for the next
      // minute and try again, keeping the job's heartbeat fresh meanwhile.
      if (err instanceof SendError && err.rateLimited === "minute" && pauses < MAX_RATE_PAUSES) {
        pauses++;
        attempt--;
        await onPause?.();
        await sleep(RATE_PAUSE_MS);
        await onPause?.();
        continue;
      }
      if (err instanceof SendError && err.rateLimited === "day") {
        throw new SendError(
          "Oracle's daily sending limit was reached -- use \"Retry failed\" tomorrow, or ask Oracle to raise the limit. " + err.message,
          false,
          "day"
        );
      }
      if (!(err instanceof SendError) || !err.retryable || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

/** Atomically takes ownership of the job. Returns false if another
 * worker holds a fresh heartbeat on it, or it's no longer sending. */
async function claim(jobId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await BulkEmailJob.findOneAndUpdate(
    {
      _id: jobId,
      status: "sending",
      $or: [{ heartbeatAt: null }, { heartbeatAt: { $lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }],
    },
    { $set: { heartbeatAt: now } },
    { projection: { _id: 1 } }
  );
  return claimed !== null;
}

export async function processBulkJob(jobId: string): Promise<void> {
  await connectToDatabase();
  if (!(await claim(jobId))) return;

  try {
    const job = await BulkEmailJob.findById(jobId).lean();
    if (!job) return;
    // Refreshes the heartbeat while a send waits out Oracle's per-minute
    // limit, so the job isn't mistaken for a dead worker and restarted.
    const keepAlive = async () => {
      await BulkEmailJob.updateOne({ _id: jobId, status: "sending" }, { $set: { heartbeatAt: new Date() } });
    };
    // Loaded once and reused for every recipient.
    const attachments = await loadAttachmentData(job.attachmentIds ?? []);

    // Work through pending recipients a batch at a time, in list order.
    // Each recipient leaves "pending" as soon as it's handled, so the
    // next query naturally starts after it -- and a restarted worker
    // picks up exactly where this one stopped.
    for (;;) {
      const batch = await BulkRecipient.find({ jobId: job._id, status: "pending" })
        .sort({ index: 1 })
        .limit(BATCH_SIZE)
        .lean();
      if (batch.length === 0) break;

      const suppressed = new Map(
        (
          await EmailSuppression.find({ workspaceId: job.workspaceId, email: { $in: batch.map((r) => r.email) } }).select("email reason")
        ).map((s) => [s.email, s.reason])
      );

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunkStarted = Date.now();

        // Checked between chunks so Cancel takes effect within a second
        // or two rather than after the whole list.
        const current = await BulkEmailJob.findById(jobId).select("status").lean();
        if (current?.status !== "sending") return;

        const chunk = batch.slice(i, i + CONCURRENCY);
        const delta: Partial<JobCounts> = {};
        const bump = (key: keyof JobCounts) => (delta[key] = (delta[key] ?? 0) + 1);

        await Promise.all(
          chunk.map(async (r) => {
            let update: Partial<IBulkRecipient>;
            const suppressedReason = suppressed.get(r.email);
            if (suppressedReason) {
              update = { status: "skipped", error: SKIP_REASON[suppressedReason] };
            } else {
              try {
                const result = await sendWithRetry({
                  ...buildMessage(job, r, {
                    openPixel: job.trackOpens ? openPixelUrl(job.publicBaseUrl, jobId, r.index) : undefined,
                    wrapLink: job.trackClicks ? (url) => clickTrackingUrl(job.publicBaseUrl, jobId, r.index, url) : undefined,
                    jobId,
                  }),
                  attachments,
                }, keepAlive);
                update = result.suppressed
                  ? { status: "skipped", error: "On Oracle's suppression list (prior bounce or complaint)" }
                  : { status: "sent", messageId: result.messageId, sentAt: new Date() };
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`[bulk-email] send to ${r.email} failed (job ${jobId}): ${reason}`);
                update = { status: "failed", error: reason.slice(0, 500) };
              }
            }
            const written = await BulkRecipient.updateOne({ _id: r._id, status: "pending" }, { $set: update });
            if (written.modifiedCount === 1) bump(update.status as keyof JobCounts);
          })
        );
        await incCounts(jobId, delta, { heartbeatAt: new Date() });

        const minChunkMs = (chunk.length / RATE_PER_SECOND) * 1000;
        const elapsed = Date.now() - chunkStarted;
        if (elapsed < minChunkMs) await sleep(minChunkMs - elapsed);
      }
    }

    await BulkEmailJob.updateOne(
      { _id: jobId, status: "sending" },
      { $set: { status: "completed", completedAt: new Date() }, $unset: { heartbeatAt: 1 } }
    );
  } catch (err) {
    await BulkEmailJob.updateOne(
      { _id: jobId, status: "sending" },
      {
        $set: { status: "failed", completedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
        $unset: { heartbeatAt: 1 },
      }
    );
  }
}

export function startBulkJob(jobId: string): void {
  waitUntil(processBulkJob(jobId).catch((err) => console.error(`[bulk-email] job ${jobId} crashed`, err)));
}

/** Restarts workers for any jobs (optionally just one workspace's) whose
 * worker has died. Called by the scheduler every minute, and from the
 * list/detail routes so opening the panel also recovers a stuck send. */
export async function resumeStaleJobs(workspaceId?: string): Promise<void> {
  const stale = await BulkEmailJob.find({
    ...(workspaceId ? { workspaceId } : {}),
    status: "sending",
    $or: [{ heartbeatAt: null }, { heartbeatAt: { $lt: new Date(Date.now() - HEARTBEAT_STALE_MS) } }],
  }).select("_id");
  for (const job of stale) startBulkJob(String(job._id));
}

/** Moves scheduled jobs whose time has come to "sending" and starts
 * them. The status flip is atomic, so a job only ever starts once. */
export async function startDueScheduledJobs(): Promise<number> {
  const due = await BulkEmailJob.find({ status: "scheduled", scheduledAt: { $lte: new Date() } }).select("_id");
  let started = 0;
  for (const { _id } of due) {
    const flipped = await BulkEmailJob.updateOne({ _id, status: "scheduled" }, { $set: { status: "sending" } });
    if (flipped.modifiedCount === 1) {
      startBulkJob(String(_id));
      started++;
    }
  }
  return started;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
