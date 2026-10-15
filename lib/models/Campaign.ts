// lib/models/Campaign.ts
//
// A named marketing campaign (e.g. "Diwali Sale 2026") grouping several
// emails: drafts still being written (EmailDraft) and sends already
// scheduled or delivered (BulkEmailJob.campaignId). Managed from Email
// Marketing → Campaigns, which also shows the campaign's combined results.

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export interface ICampaign extends Document {
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: String,
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export const Campaign: Model<ICampaign> = emailModel<ICampaign>("Campaign", CampaignSchema);
