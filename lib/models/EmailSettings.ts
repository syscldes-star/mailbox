// lib/models/EmailSettings.ts
//
// Per-workspace Bulk Email settings, edited from the panel's Settings tab.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export interface IEmailSettings extends Document {
  workspaceId: string;
  /** Business postal address, added to every bulk email's footer. */
  postalAddress?: string;
  /** Max recipients this workspace may queue per rolling 24 hours. */
  dailyLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}

const EmailSettingsSchema = new Schema<IEmailSettings>(
  {
    workspaceId: { type: String, required: true, unique: true },
    postalAddress: { type: String, trim: true },
    dailyLimit: Number,
  },
  { timestamps: true }
);

const db = emailDb();
export const EmailSettings: Model<IEmailSettings> =
  (db.models.EmailSettings as Model<IEmailSettings> | undefined) ?? db.model<IEmailSettings>("EmailSettings", EmailSettingsSchema);
