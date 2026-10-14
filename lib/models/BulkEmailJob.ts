// lib/models/BulkEmailJob.ts
//
// One bulk send ("campaign" in the loose sense) -- the message itself
// plus every recipient and their individual delivery outcome. Recipients
// are embedded rather than a separate collection: jobs are capped at
// MAX_RECIPIENTS_PER_JOB, which keeps the document comfortably under
// Mongo's 16MB limit while letting progress updates stay a single
// atomic write per recipient.

import mongoose, { Schema, type Document, type Model } from "mongoose";

export type BulkJobStatus = "sending" | "completed" | "cancelled" | "failed";
export type RecipientStatus = "pending" | "sent" | "failed" | "skipped";

export interface IBulkRecipient {
  email: string;
  name?: string;
  vars?: Record<string, string>;
  status: RecipientStatus;
  error?: string;
  messageId?: string;
  sentAt?: Date;
  /** First time the tracking pixel loaded -- i.e. first open. */
  openedAt?: Date;
  lastOpenedAt?: Date;
  openCount?: number;
}

export interface IBulkEmailJob extends Document {
  workspaceId: string;
  createdBy: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  bodyHtml: string;
  /** Whether each email carries an open-tracking pixel. */
  trackOpens?: boolean;
  /** Absolute base URL unsubscribe links point at, captured at creation
   * time since the background worker has no request to derive it from. */
  publicBaseUrl: string;
  recipients: IBulkRecipient[];
  status: BulkJobStatus;
  /** Last time a worker touched this job. A "sending" job whose
   * heartbeat is stale had its worker die (server restart, deploy) and
   * may be picked up again -- see process-job.ts. */
  heartbeatAt?: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RecipientSchema = new Schema<IBulkRecipient>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: String,
    vars: { type: Schema.Types.Mixed },
    status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending" },
    error: String,
    messageId: String,
    sentAt: Date,
    openedAt: Date,
    lastOpenedAt: Date,
    openCount: Number,
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
    bodyHtml: { type: String, required: true },
    trackOpens: { type: Boolean, default: false },
    publicBaseUrl: { type: String, required: true },
    recipients: { type: [RecipientSchema], default: [] },
    status: {
      type: String,
      enum: ["sending", "completed", "cancelled", "failed"],
      default: "sending",
      index: true,
    },
    heartbeatAt: Date,
    completedAt: Date,
    error: String,
  },
  { timestamps: true }
);

export const BulkEmailJob: Model<IBulkEmailJob> =
  mongoose.models.BulkEmailJob ?? mongoose.model<IBulkEmailJob>("BulkEmailJob", BulkEmailJobSchema);
