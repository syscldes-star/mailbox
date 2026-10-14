// lib/models/EmailAttachment.ts
//
// Files attached to bulk emails. Stored in the email database (they're
// small -- OCI caps the whole message size) and referenced by id from
// each send that uses them.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";

export interface IEmailAttachment extends Document {
  workspaceId: string;
  filename: string;
  contentType: string;
  size: number;
  data: Buffer;
  createdBy: string;
  createdAt: Date;
}

const EmailAttachmentSchema = new Schema<IEmailAttachment>(
  {
    workspaceId: { type: String, required: true, index: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

const db = emailDb();
export const EmailAttachment: Model<IEmailAttachment> =
  (db.models.EmailAttachment as Model<IEmailAttachment> | undefined) ??
  db.model<IEmailAttachment>("EmailAttachment", EmailAttachmentSchema);
