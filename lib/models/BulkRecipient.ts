// lib/models/BulkRecipient.ts
//
// One recipient of one bulk send, and what happened to their email.
// Kept in its own collection (not embedded in the job) so sends can be
// large: every delivery/open/click updates a small document instead of
// rewriting a job holding the whole list.
//
// `index` is the recipient's position within the send. Tracking links
// in already-delivered emails identify recipients by (jobId, index), so
// it must never change.

import { Schema, Types, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export type RecipientStatus = "pending" | "sent" | "failed" | "skipped";

export interface IBulkRecipient {
  _id: Types.ObjectId;
  jobId: Types.ObjectId;
  workspaceId: string;
  index: number;
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
  /** When they unsubscribed using this email's link. */
  unsubscribedAt?: Date;
  /** Distinct destination URLs this recipient clicked. */
  clickedLinks?: string[];
  /** Set by the bounce/complaint sync when Oracle reports a problem
   * after the email was accepted. */
  deliveryIssue?: "bounced" | "soft_bounced" | "complained";
  deliveryIssueAt?: Date;
}

const BulkRecipientSchema = new Schema<IBulkRecipient>({
  jobId: { type: Schema.Types.ObjectId, required: true },
  workspaceId: { type: String, required: true },
  index: { type: Number, required: true },
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
  unsubscribedAt: Date,
  clickedLinks: { type: [String], default: undefined },
  deliveryIssue: { type: String, enum: ["bounced", "soft_bounced", "complained"] },
  deliveryIssueAt: Date,
});

BulkRecipientSchema.index({ jobId: 1, index: 1 }, { unique: true });
// Also de-duplicates addresses across upload batches of the same send.
BulkRecipientSchema.index({ jobId: 1, email: 1 }, { unique: true });
BulkRecipientSchema.index({ jobId: 1, status: 1, index: 1 });
// Bounce sync and contact profiles look recipients up by address.
BulkRecipientSchema.index({ email: 1, status: 1 });
BulkRecipientSchema.index({ workspaceId: 1, email: 1, _id: -1 });
// Overview's "by activity date" chart: opens and clicks per day.
BulkRecipientSchema.index({ workspaceId: 1, openedAt: 1 }, { partialFilterExpression: { openedAt: { $exists: true } } });
BulkRecipientSchema.index({ workspaceId: 1, clickedAt: 1 }, { partialFilterExpression: { clickedAt: { $exists: true } } });

export const BulkRecipient: Model<IBulkRecipient> = emailModel<IBulkRecipient>("BulkRecipient", BulkRecipientSchema);
