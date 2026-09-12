// lib/models/CustomDomain.ts
//
// Minimal, read-only mirror of main/site's CustomDomain model -- only
// what email-service needs to confirm a domain is a real, verified
// custom domain connected to one of the workspace's own websites. Never
// written to from here (site owns this collection).

import mongoose, { Schema, type Document, type Model } from "mongoose";

export interface ICustomDomain extends Document {
  websiteId: mongoose.Types.ObjectId;
  domain: string;
  vercelVerified: boolean;
}

const CustomDomainSchema = new Schema<ICustomDomain>(
  {
    websiteId: { type: Schema.Types.ObjectId, ref: "Website", required: true },
    domain: { type: String, required: true },
    vercelVerified: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false }
);

export const CustomDomain: Model<ICustomDomain> =
  mongoose.models.CustomDomain ?? mongoose.model<ICustomDomain>("CustomDomain", CustomDomainSchema);
