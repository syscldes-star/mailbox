// lib/models/EmailFile.ts
//
// Files hosted for download from an email (too big to attach -- Oracle
// limits the whole message to a few MB). Uploaded in pieces (EmailFileChunk)
// so each request stays under the server's upload limit, and served
// publicly at /api/files/<id>/<filename> as a download.

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export const MAX_HOSTED_FILE_BYTES = 25 * 1024 * 1024;
/** Each piece stays well under nginx's default 1 MB request limit. */
export const FILE_CHUNK_BYTES = 768 * 1024;

export interface IEmailFile extends Document {
  workspaceId: string;
  filename: string;
  contentType: string;
  size: number;
  chunks: number;
  complete: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailFileSchema = new Schema<IEmailFile>(
  {
    workspaceId: { type: String, required: true, index: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    chunks: { type: Number, required: true },
    complete: { type: Boolean, default: false },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export const EmailFile: Model<IEmailFile> = emailModel<IEmailFile>("EmailFile", EmailFileSchema);

export interface IEmailFileChunk extends Document {
  fileId: string;
  n: number;
  data: Buffer;
}

const EmailFileChunkSchema = new Schema<IEmailFileChunk>({
  fileId: { type: String, required: true },
  n: { type: Number, required: true },
  data: { type: Buffer, required: true },
});
EmailFileChunkSchema.index({ fileId: 1, n: 1 }, { unique: true });

export const EmailFileChunk: Model<IEmailFileChunk> = emailModel<IEmailFileChunk>("EmailFileChunk", EmailFileChunkSchema);
