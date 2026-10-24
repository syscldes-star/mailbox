// lib/models/EmailTemplate.ts
//
// Saved, reusable bulk email messages (subject, preview text and body),
// managed from the panel's Templates tab and loadable into Compose.

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export interface IEmailTemplate extends Document {
  workspaceId: string;
  name: string;
  subject: string;
  preheader?: string;
  bodyHtml: string;
  createdBy: string;
  /** Team members the workspace owner shared this with (user ids). Members
   * see what they created plus what's shared with them (lib/visibility.ts). */
  sharedWith: string[];
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>(
  {
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, default: "" },
    preheader: String,
    bodyHtml: { type: String, required: true },
    createdBy: { type: String, required: true },
    sharedWith: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const EmailTemplate: Model<IEmailTemplate> = emailModel<IEmailTemplate>("EmailTemplate", EmailTemplateSchema);
