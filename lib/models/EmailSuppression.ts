// lib/models/EmailSuppression.ts
//
// Per-workspace "do not email" list. Populated by the public unsubscribe
// link included in every bulk email; bulk sends skip any address on it.

import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IEmailSuppression extends Document {
  workspaceId: string;
  email: string;
  reason: "unsubscribed";
  createdAt: Date;
  updatedAt: Date;
}

const EmailSuppressionSchema = new Schema<IEmailSuppression>(
  {
    workspaceId: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    reason: { type: String, enum: ["unsubscribed"], default: "unsubscribed" },
  },
  { timestamps: true }
);

EmailSuppressionSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

export const EmailSuppression: Model<IEmailSuppression> =
  mongoose.models.EmailSuppression ??
  mongoose.model<IEmailSuppression>("EmailSuppression", EmailSuppressionSchema);
