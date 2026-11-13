// lib/integrations/models.ts
//
// The Email panel's links to other apps: the CRM it writes signups and
// engagement into (one per workspace), a queue of events waiting to reach
// it, and the keys other apps (the CRM...) use to read this panel. On the
// email database (emailDb).

import { Schema, type Model } from "mongoose";
import { emailModel } from "../db/mongodb";

export interface ICrmLink {
  _id: unknown;
  workspaceId: string;
  /** The CRM's address, e.g. https://crm.example.com */
  baseUrl: string;
  /** Its API key (Read & write), encrypted. */
  keyEnc: string;
  keyHint: string;
  status: "ok" | "failed";
  lastCheckedAt: Date | null;
  lastError: string;
  crmWorkspace: string;
  /** Confirmed signup-form subscribers become CRM leads... */
  signupLeads: boolean;
  /** ...except from these forms. */
  offForms: string[];
  /** A lead's first open and first click of a bulk email go in its history. */
  engagementNotes: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CrmLinkSchema = new Schema<ICrmLink>(
  {
    workspaceId: { type: String, required: true, unique: true },
    baseUrl: { type: String, required: true },
    keyEnc: { type: String, required: true },
    keyHint: { type: String, default: "" },
    status: { type: String, enum: ["ok", "failed"], default: "failed" },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    crmWorkspace: { type: String, default: "" },
    signupLeads: { type: Boolean, default: true },
    offForms: { type: [String], default: [] },
    engagementNotes: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export const CrmLink: Model<ICrmLink> = emailModel<ICrmLink>("CrmLink", CrmLinkSchema);

/** One thing to write into the CRM: a signup, or a first open / click.
 * Tried again until it gets through (up to 6 times); kept 30 days. */
export interface ICrmEvent {
  _id: unknown;
  workspaceId: string;
  kind: "signup" | "open" | "click";
  email: string;
  name: string;
  /** Signup: the form's name. Open/click: the email's subject. */
  detail: string;
  /** Click: the link. */
  link: string;
  status: "pending" | "done" | "failed" | "skipped";
  attempts: number;
  nextAt: Date | null;
  result: string;
  leadId: string;
  createdAt: Date;
}

const CrmEventSchema = new Schema<ICrmEvent>(
  {
    workspaceId: { type: String, required: true },
    kind: { type: String, enum: ["signup", "open", "click"], required: true },
    email: { type: String, required: true, lowercase: true },
    name: { type: String, default: "" },
    detail: { type: String, default: "" },
    link: { type: String, default: "" },
    status: { type: String, enum: ["pending", "done", "failed", "skipped"], default: "pending" },
    attempts: { type: Number, default: 0 },
    nextAt: { type: Date, default: () => new Date() },
    result: { type: String, default: "" },
    leadId: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
CrmEventSchema.index({ status: 1, nextAt: 1 });
CrmEventSchema.index({ workspaceId: 1, createdAt: -1 });
CrmEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 });

export const CrmEvent: Model<ICrmEvent> = emailModel<ICrmEvent>("CrmEvent", CrmEventSchema);

/** A key for this panel's API (/api/v1), e.g. for the CRM's Connected
 * apps. Only its hash is kept. */
export interface IEmailApiKey {
  _id: unknown;
  workspaceId: string;
  name: string;
  hash: string;
  hint: string;
  createdBy: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const EmailApiKeySchema = new Schema<IEmailApiKey>(
  {
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    hash: { type: String, required: true, unique: true },
    hint: { type: String, default: "" },
    createdBy: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const EmailApiKey: Model<IEmailApiKey> = emailModel<IEmailApiKey>("EmailApiKey", EmailApiKeySchema);
