// lib/bulk-email/bounces.ts
//
// Bounce and spam-complaint sync. OCI Email Delivery accepts a message
// first and only learns later whether it bounced or was reported as
// spam; when it does, it adds the address to the tenancy's suppression
// list. This reads new entries from that list and:
//  - marks the matching recipients in recent bulk sends (deliveryIssue),
//  - adds hard bounces and complaints to each affected workspace's own
//    do-not-email list, so they show up (and can be managed) in the panel.
// Runs every 15 minutes from the scheduler, and on demand from the
// Unsubscribes tab.

import * as common from "oci-common";
import * as email from "oci-email";
import { connectToDatabase } from "../db/mongodb";
import { incCounts } from "../models/BulkEmailJob";
import { BulkRecipient } from "../models/BulkRecipient";
import { EmailSuppression } from "../models/EmailSuppression";
import { SyncState } from "../models/SyncState";

const CURSOR_ID = "oci-suppressions";
/** Re-read a little before the last cursor so entries Oracle writes
 * slightly out of order aren't missed; processing is idempotent. */
const OVERLAP_MS = 60 * 60 * 1000;
/** On the very first run, look this far back. */
const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
/** A suppression is matched to sends from this long before it. */
const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getClient(): email.EmailClient {
  const privateKey = (process.env.OCI_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const provider = new common.SimpleAuthenticationDetailsProvider(
    process.env.OCI_TENANCY_OCID!,
    process.env.OCI_USER_OCID!,
    process.env.OCI_FINGERPRINT!,
    privateKey,
    null,
    common.Region.fromRegionId(process.env.OCI_REGION!)
  );
  return new email.EmailClient({ authenticationDetailsProvider: provider });
}

type Issue = "bounced" | "soft_bounced" | "complained";

function classify(reason?: string): Issue | null {
  switch (reason) {
    case email.models.SuppressionReason.Hardbounce:
      return "bounced";
    case email.models.SuppressionReason.Softbounce:
      return "soft_bounced";
    case email.models.SuppressionReason.Complaint:
      return "complained";
    default:
      // UNSUBSCRIBE / MANUAL / UNKNOWN: not a delivery problem we report.
      return null;
  }
}

export interface BounceSyncResult {
  checked: number;
  recipientsMarked: number;
  suppressionsAdded: number;
}

let running: Promise<BounceSyncResult> | null = null;

/** Safe to call concurrently -- overlapping calls share one run. */
export function syncBounces(): Promise<BounceSyncResult> {
  if (!running) running = runSync().finally(() => (running = null));
  return running;
}

async function runSync(): Promise<BounceSyncResult> {
  await connectToDatabase();
  const cursor = await SyncState.findById(CURSOR_ID).lean();
  const since = cursor ? new Date(cursor.at.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);
  const startedAt = new Date();

  const result: BounceSyncResult = { checked: 0, recipientsMarked: 0, suppressionsAdded: 0 };
  const iterator = getClient().listSuppressionsRecordIterator({
    compartmentId: process.env.OCI_COMPARTMENT_OCID!,
    timeCreatedGreaterThanOrEqualTo: since,
    sortBy: email.requests.ListSuppressionsRequest.SortBy.Timecreated,
    sortOrder: email.models.SortOrder.Asc,
  });

  for await (const entry of iterator) {
    result.checked++;
    const issue = classify(entry.reason);
    const address = entry.emailAddress?.toLowerCase();
    if (!issue || !address) continue;
    const at = entry.timeCreated ? new Date(entry.timeCreated) : new Date();

    // Recipients this address was sent to shortly before Oracle reported
    // it, not already marked. Each job's totals are bumped by its share.
    const affected = await BulkRecipient.find({
      email: address,
      status: "sent",
      sentAt: { $gte: new Date(at.getTime() - MATCH_WINDOW_MS), $lte: at },
      deliveryIssue: null,
    })
      .select("_id jobId")
      .lean();
    if (affected.length > 0) {
      const marked = await BulkRecipient.updateMany(
        { _id: { $in: affected.map((r) => r._id) }, deliveryIssue: null },
        { $set: { deliveryIssue: issue, deliveryIssueAt: at } }
      );
      result.recipientsMarked += marked.modifiedCount;
      const perJob = new Map<string, number>();
      for (const r of affected) perJob.set(String(r.jobId), (perJob.get(String(r.jobId)) ?? 0) + 1);
      for (const [jobId, n] of perJob) {
        await incCounts(jobId, issue === "complained" ? { complained: n } : { bounced: n });
      }
    }

    // Soft bounces (full mailbox, temporary outage) may succeed later,
    // so only hard bounces and complaints go on the do-not-email list.
    if (issue === "soft_bounced") continue;
    const workspaceIds: string[] = await BulkRecipient.distinct("workspaceId", { email: address });
    for (const workspaceId of workspaceIds) {
      const added = await EmailSuppression.updateOne(
        { workspaceId, email: address },
        { $setOnInsert: { workspaceId, email: address, reason: issue === "bounced" ? "bounced" : "complained" } },
        { upsert: true }
      );
      result.suppressionsAdded += added.upsertedCount;
    }
  }

  await SyncState.updateOne({ _id: CURSOR_ID }, { $set: { at: startedAt } }, { upsert: true });
  return result;
}
