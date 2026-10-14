// lib/models/EmailSettings.ts
//
// Per-workspace Bulk Email settings, edited from the panel's Settings tab.

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export interface IEmailSettings extends Document {
  workspaceId: string;
  /** Business postal address, added to every bulk email's footer. */
  postalAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailSettingsSchema = new Schema<IEmailSettings>(
  {
    workspaceId: { type: String, required: true, unique: true },
    postalAddress: { type: String, trim: true },
  },
  { timestamps: true }
);

export const EmailSettings: Model<IEmailSettings> = emailModel<IEmailSettings>("EmailSettings", EmailSettingsSchema);
