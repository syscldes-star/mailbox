// lib/models/Website.ts
//
// Minimal, read-only mirror of main/site's Website model -- only the
// fields email-service actually needs to verify a domain (custom or free
// subdomain) genuinely belongs to the workspace asking to provision email
// for it. Never written to from here.

import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface IWebsite extends Document {
  workspaceId: mongoose.Types.ObjectId;
  publishedSlug?: string;
}

const WebsiteSchema = new Schema<IWebsite>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    publishedSlug: { type: String },
  },
  { timestamps: true, strict: false } // strict:false -- ignore the many other fields this model has in main/site, we only care about these two
);

export const Website: Model<IWebsite> =
  mongoose.models.Website ?? mongoose.model<IWebsite>("Website", WebsiteSchema);
