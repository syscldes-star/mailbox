// lib/models/BulkEmailJob.ts
//
// One bulk send ("campaign" in the loose sense) -- the message itself
// plus every recipient and their individual delivery outcome. Recipients
// are embedded rather than a separate collection: jobs are capped at
// MAX_RECIPIENTS_PER_JOB, which keeps the document comfortably under
// Mongo's 16MB limit while letting progress updates stay a single
// atomic write per recipient.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

/** "testing": an A/B test's test group has been sent and the job is
 * waiting for its decision time before sending the winner to the rest. */
export type BulkJobStatus = "scheduled" | "sending" | "testing" | "completed" | "cancelled" | "failed";

export interface IAbTest {
  subjectB: string;
  /** Share of recipients in the test group, split evenly between A and B. */
  testPercent: number;
  waitHours: number;
  metric: "opens" | "clicks";
  decideAt: Date;
  winner?: "A" | "B";
  decidedAt?: Date;
  /** "auto" when the scheduler picked it, "manual" when someone did. */
  decidedBy?: "auto" | "manual";
}
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
  /** First tracked link click. */
  clickedAt?: Date;
  lastClickedAt?: Date;
  clickCount?: number;
  /** Distinct destination URLs this recipient clicked. */
  clickedLinks?: string[];
  /** Set by the bounce/complaint sync when Oracle reports a problem
   * after the email was accepted. */
  deliveryIssue?: "bounced" | "soft_bounced" | "complained";
  deliveryIssueAt?: Date;
  /** A/B test group: "A"/"B" get the respective subject, "rest" waits
   * for the winner. Absent on sends without an A/B test. */
  variant?: "A" | "B" | "rest";
}

export interface IBulkEmailJob extends Document {
  workspaceId: string;
  createdBy: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  /** Inbox preview text shown after the subject in most mail clients. */
  preheader?: string;
  bodyHtml: string;
  /** Whether each email carries an open-tracking pixel. */
  trackOpens?: boolean;
  /** Whether links are routed through the click-tracking redirect. */
  trackClicks?: boolean;
  /** Absolute base URL unsubscribe links point at, captured at creation
   * time since the background worker has no request to derive it from. */
  publicBaseUrl: string;
  /** Snapshot of the workspace's postal address at send time. */
  postalAddress?: string;
  recipients: IBulkRecipient[];
  status: BulkJobStatus;
  abTest?: IAbTest;
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
    clickedAt: Date,
    lastClickedAt: Date,
    clickCount: Number,
    clickedLinks: { type: [String], default: undefined },
    deliveryIssue: { type: String, enum: ["bounced", "soft_bounced", "complained"] },
    deliveryIssueAt: Date,
    variant: { type: String, enum: ["A", "B", "rest"] },
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
    preheader: String,
    bodyHtml: { type: String, required: true },
    trackOpens: { type: Boolean, default: false },
    trackClicks: { type: Boolean, default: false },
    publicBaseUrl: { type: String, required: true },
    postalAddress: String,
    recipients: { type: [RecipientSchema], default: [] },
    status: {
      type: String,
      enum: ["scheduled", "sending", "testing", "completed", "cancelled", "failed"],
      default: "sending",
      index: true,
    },
    scheduledAt: Date,
    abTest: {
      type: new Schema<IAbTest>(
        {
          subjectB: { type: String, required: true },
          testPercent: { type: Number, required: true },
          waitHours: { type: Number, required: true },
          metric: { type: String, enum: ["opens", "clicks"], required: true },
          decideAt: { type: Date, required: true },
          winner: { type: String, enum: ["A", "B"] },
          decidedAt: Date,
          decidedBy: { type: String, enum: ["auto", "manual"] },
        },
        { _id: false }
      ),
      default: undefined,
    },
    heartbeatAt: Date,
    completedAt: Date,
    error: String,
  },
  { timestamps: true }
);

// The bounce sync looks recipients up by address across all jobs.
BulkEmailJobSchema.index({ "recipients.email": 1 });

const db = emailDb();
export const BulkEmailJob: Model<IBulkEmailJob> =
  (db.models.BulkEmailJob as Model<IBulkEmailJob> | undefined) ?? db.model<IBulkEmailJob>("BulkEmailJob", BulkEmailJobSchema);
