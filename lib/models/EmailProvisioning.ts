// lib/models/EmailProvisioning.ts
//
// Persists the provisioning pipeline's progress per domain. Lives in the
// same MongoDB database as User/WorkspaceMember (connectToDatabase points
// at the same MONGODB_URI as main/site) so this app is genuinely part of
// the same platform, not an island.

import mongoose, { Schema, type Document, type Model } from "mongoose";
import type { ProvisioningStep, StepStatus } from "../email-provisioning/types";

export interface IEmailProvisioning extends Document {
  domain: string;
  workspaceId: string;
  defaultMailboxLocalPart: string;
  defaultMailboxPassword: string;
  steps: Record<ProvisioningStep, StepStatus>;
  errors: Partial<Record<ProvisioningStep, string>>;
  oracleEmailDomainId?: string;
  oracleDkimId?: string;
  oracleDkimCnameName?: string;
  oracleDkimCnameValue?: string;
  oracleSenderId?: string;
  updatedAt: Date;
  createdAt: Date;
}

const EmailProvisioningSchema = new Schema<IEmailProvisioning>(
  {
    domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    workspaceId: { type: String, required: true, index: true },
    defaultMailboxLocalPart: { type: String, required: true },
    // Stored so the default mailbox can be re-created on retry without
    // re-prompting the customer -- rotate/expire this once the mailbox
    // exists and the customer has set their own password via SOGo.
    defaultMailboxPassword: { type: String, required: true, select: false },
    steps: { type: Schema.Types.Mixed, required: true },
    errors: { type: Schema.Types.Mixed, default: {} },
    oracleEmailDomainId: String,
    oracleDkimId: String,
    oracleDkimCnameName: String,
    oracleDkimCnameValue: String,
    oracleSenderId: String,
  },
  { timestamps: true }
);

export const EmailProvisioning: Model<IEmailProvisioning> =
  mongoose.models.EmailProvisioning ??
  mongoose.model<IEmailProvisioning>("EmailProvisioning", EmailProvisioningSchema);
