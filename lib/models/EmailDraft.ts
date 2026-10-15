// lib/models/EmailDraft.ts
//
// An email saved from Compose but not sent yet -- everything needed to
// reopen it later, recipients included. Usually part of a campaign. It is
// deleted once the email is sent (the send itself then lives on as a
// BulkEmailJob carrying the same campaignId).

import { Schema, type Document, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

/** Recipient text kept with a draft (about 50,000 rows of CSV). */
export const MAX_DRAFT_RECIPIENTS_CHARS = 8 * 1024 * 1024;

export interface IEmailDraft extends Document {
  workspaceId: string;
  campaignId?: string;
  fromDomain?: string;
  fromLocalPart?: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  preheader?: string;
  bodyHtml: string;
  recipientsText?: string;
  /** Rows in recipientsText, so lists don't need to load the text. */
  recipientCount: number;
  trackOpens: boolean;
  trackClicks: boolean;
  utm?: { source: string; medium: string; campaign: string };
  attachments?: { id: string; filename: string; size: number }[];
  createdBy: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmailDraftSchema = new Schema<IEmailDraft>(
  {
    workspaceId: { type: String, required: true },
    campaignId: String,
    fromDomain: String,
    fromLocalPart: String,
    fromName: String,
    replyTo: String,
    subject: { type: String, default: "" },
    preheader: String,
    bodyHtml: { type: String, default: "" },
    recipientsText: String,
    recipientCount: { type: Number, default: 0 },
    trackOpens: { type: Boolean, default: true },
    trackClicks: { type: Boolean, default: true },
    utm: {
      type: new Schema({ source: String, medium: String, campaign: String }, { _id: false }),
      default: undefined,
    },
    attachments: {
      type: [new Schema({ id: String, filename: String, size: Number }, { _id: false })],
      default: undefined,
    },
    createdBy: { type: String, required: true },
    updatedBy: String,
  },
  { timestamps: true }
);

EmailDraftSchema.index({ workspaceId: 1, campaignId: 1, updatedAt: -1 });

export const EmailDraft: Model<IEmailDraft> = emailModel<IEmailDraft>("EmailDraft", EmailDraftSchema);
