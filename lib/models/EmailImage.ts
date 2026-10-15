// lib/models/EmailImage.ts
//
// Images uploaded to the workspace's image library for use in emails.
// They're served publicly at /api/img/<id>.<ext> (email clients load
// images without logging in), so only web image formats are accepted.

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export interface IEmailImage extends Document {
  workspaceId: string;
  filename: string;
  contentType: string;
  /** Extension used in the public URL (png, jpg, gif, webp). */
  ext: string;
  size: number;
  data: Buffer;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailImageSchema = new Schema<IEmailImage>(
  {
    workspaceId: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    ext: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

EmailImageSchema.index({ workspaceId: 1, createdAt: -1 });

export const EmailImage: Model<IEmailImage> = emailModel<IEmailImage>("EmailImage", EmailImageSchema);
