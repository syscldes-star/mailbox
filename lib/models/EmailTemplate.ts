// lib/models/EmailTemplate.ts
//
// Saved, reusable bulk email messages (subject, preview text and body),
// managed from the panel's Templates tab and loadable into Compose.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export interface IEmailTemplate extends Document {
  workspaceId: string;
  name: string;
  subject: string;
  preheader?: string;
  bodyHtml: string;
  createdBy: string;
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
  },
  { timestamps: true }
);

const db = emailDb();
export const EmailTemplate: Model<IEmailTemplate> =
  (db.models.EmailTemplate as Model<IEmailTemplate> | undefined) ?? db.model<IEmailTemplate>("EmailTemplate", EmailTemplateSchema);
