// lib/models/BulkEmailJob.ts
//
// One bulk send -- the message, its settings and running totals. The
// recipients themselves live in the BulkRecipient collection; `counts`
// is kept up to date as they're sent, opened and clicked, so listing
// sends never has to scan every recipient.

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export type { IBulkRecipient, RecipientStatus } from "./BulkRecipient";

/** "preparing": created, recipients still being uploaded in batches. */
export type BulkJobStatus = "preparing" | "scheduled" | "sending" | "completed" | "cancelled" | "failed";

export interface JobCounts {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  /** Recipients who unsubscribed using this email's link. */
  unsubscribed: number;
}

export const EMPTY_COUNTS: JobCounts = {
  total: 0, sent: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0,
};

export interface IBulkEmailJob extends Document {
  workspaceId: string;
  createdBy: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  /** Campaign this send belongs to, if any. */
  campaignId?: string;
  /** Inbox preview text shown after the subject in most mail clients. */
  preheader?: string;
  bodyHtml: string;
  /** Whether each email carries an open-tracking pixel. */
  trackOpens?: boolean;
  /** Whether links are routed through the click-tracking redirect. */
  trackClicks?: boolean;
  /** EmailAttachment ids sent with every email of this send. */
  attachmentIds?: string[];
  /** Campaign tags added to every link, for web analytics. */
  utm?: { source: string; medium: string; campaign: string };
  /** Absolute base URL unsubscribe links point at, captured at creation
   * time since the background worker has no request to derive it from. */
  publicBaseUrl: string;
  /** Snapshot of the workspace's postal address at send time. */
  postalAddress?: string;
  counts: JobCounts;
  status: BulkJobStatus;
  /** When a "scheduled" job should start sending. */
  scheduledAt?: Date;
  /** Last time a worker touched this job. A "sending" job whose
   * heartbeat is stale had its worker die (server restart, deploy) and
   * may be picked up again -- see process-job.ts. */
  heartbeatAt?: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CountsSchema = new Schema<JobCounts>(
  {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    bounced: { type: Number, default: 0 },
    complained: { type: Number, default: 0 },
    unsubscribed: { type: Number, default: 0 },
  },
  { _id: false }
);

const BulkEmailJobSchema = new Schema<IBulkEmailJob>(
  {
    workspaceId: { type: String, required: true, index: true },
    createdBy: { type: String, required: true },
    fromDomain: { type: String, required: true, lowercase: true },
    fromLocalPart: { type: String, required: true, lowercase: true },
    fromName: String,
    replyTo: String,
    subject: { type: String, required: true },
    campaignId: String,
    preheader: String,
    bodyHtml: { type: String, required: true },
    trackOpens: { type: Boolean, default: false },
    trackClicks: { type: Boolean, default: false },
    attachmentIds: { type: [String], default: undefined },
    utm: {
      type: new Schema({ source: String, medium: String, campaign: String }, { _id: false }),
      default: undefined,
    },
    publicBaseUrl: { type: String, required: true },
    postalAddress: String,
    counts: { type: CountsSchema, default: () => ({ ...EMPTY_COUNTS }) },
    status: {
      type: String,
      enum: ["preparing", "scheduled", "sending", "completed", "cancelled", "failed"],
      default: "preparing",
      index: true,
    },
    scheduledAt: Date,
    heartbeatAt: Date,
    completedAt: Date,
    error: String,
  },
  { timestamps: true }
);

BulkEmailJobSchema.index({ workspaceId: 1, campaignId: 1, createdAt: -1 });

export const BulkEmailJob: Model<IBulkEmailJob> = emailModel<IBulkEmailJob>("BulkEmailJob", BulkEmailJobSchema);

/** Adjusts a job's running totals, e.g. incCounts(id, { sent: 1 }). */
export function incCounts(jobId: unknown, delta: Partial<JobCounts>, extra: Record<string, unknown> = {}) {
  const inc = Object.fromEntries(Object.entries(delta).filter(([, v]) => v).map(([k, v]) => [`counts.${k}`, v]));
  if (Object.keys(inc).length === 0 && Object.keys(extra).length === 0) return Promise.resolve();
  return BulkEmailJob.updateOne(
    { _id: jobId },
    { ...(Object.keys(inc).length ? { $inc: inc } : {}), ...(Object.keys(extra).length ? { $set: extra } : {}) }
  );
}
