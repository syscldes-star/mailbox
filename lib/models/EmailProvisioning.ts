// lib/models/EmailProvisioning.ts
//
// Persists the provisioning pipeline's progress per domain. Lives in the
// email service's own database (EMAIL_MONGODB_URI) when that's set,
// otherwise alongside User/WorkspaceMember in the main database.

import { Schema, type Document, type Model } from "mongoose";
import { emailDb } from "../db/mongodb";
import type { ProvisioningStep, StepStatus } from "../email-provisioning/types";

export interface IEmailProvisioning extends Document {
  domain: string;
  workspaceId: string;
  defaultMailboxLocalPart: string;
  defaultMailboxPassword: string;
  defaultMailboxPasswordRevealed: boolean;
  steps: Record<ProvisioningStep, StepStatus>;
  // Named stepErrors, not errors -- Mongoose's own Document type already
  // reserves "errors" for its internal validation system, and reusing
  // that name causes a real TypeScript conflict that only surfaces
  // under `next build`'s full type-check (next dev doesn't catch it).
  // Records saved before the rename still hold theirs under "errors";
  // state-store.ts reads that as a fallback.
  stepErrors: Partial<Record<ProvisioningStep, string>>;
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
    defaultMailboxPasswordRevealed: { type: Boolean, default: false },
    steps: { type: Schema.Types.Mixed, required: true },
    stepErrors: { type: Schema.Types.Mixed, default: {} },
    oracleEmailDomainId: String,
    oracleDkimId: String,
    oracleDkimCnameName: String,
    oracleDkimCnameValue: String,
    oracleSenderId: String,
  },
  { timestamps: true }
);

const db = emailDb();
export const EmailProvisioning: Model<IEmailProvisioning> =
  (db.models.EmailProvisioning as Model<IEmailProvisioning> | undefined) ?? db.model<IEmailProvisioning>("EmailProvisioning", EmailProvisioningSchema);
