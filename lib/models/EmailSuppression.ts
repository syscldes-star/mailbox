// lib/models/EmailSuppression.ts
//
// Per-workspace "do not email" list. Populated by the public unsubscribe
// link in every bulk email, by the bounce/complaint sync (bounces.ts),
// and by hand from the panel's Unsubscribes tab. Bulk sends skip any
// address on it.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export type SuppressionReason = "unsubscribed" | "bounced" | "complained" | "manual";
export const SUPPRESSION_REASONS: SuppressionReason[] = ["unsubscribed", "bounced", "complained", "manual"];

export interface IEmailSuppression extends Document {
  workspaceId: string;
  email: string;
  reason: SuppressionReason;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailSuppressionSchema = new Schema<IEmailSuppression>(
  {
    workspaceId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    reason: { type: String, enum: SUPPRESSION_REASONS, default: "unsubscribed" },
    note: String,
  },
  { timestamps: true }
);

EmailSuppressionSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

const db = emailDb();
export const EmailSuppression: Model<IEmailSuppression> =
  (db.models.EmailSuppression as Model<IEmailSuppression> | undefined) ?? db.model<IEmailSuppression>("EmailSuppression", EmailSuppressionSchema);
