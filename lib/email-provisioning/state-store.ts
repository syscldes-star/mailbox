// lib/email-provisioning/state-store.ts
//
// Real loadState/saveState implementation. Also adds loadStatesForWorkspace
// for the dashboard UI, and markPasswordRevealed for the one-time password
// reveal flow in GET /api/email/domains.

import { connectToDatabase } from "../db/mongodb";
import { EmailProvisioning } from "../models/EmailProvisioning";
import type { ProvisioningState } from "./types";

function toState(doc: any): ProvisioningState {
  return {
    domain: doc.domain,
    customerId: doc.workspaceId,
    defaultMailboxLocalPart: doc.defaultMailboxLocalPart,
    defaultMailboxPassword: doc.defaultMailboxPassword ?? "",
    defaultMailboxPasswordRevealed: doc.defaultMailboxPasswordRevealed ?? false,
    steps: doc.steps,
    errors: doc.errors ?? {},
    oracleEmailDomainId: doc.oracleEmailDomainId,
    oracleDkimId: doc.oracleDkimId,
    oracleDkimCnameName: doc.oracleDkimCnameName,
    oracleDkimCnameValue: doc.oracleDkimCnameValue,
    oracleSenderId: doc.oracleSenderId,
    updatedAt: doc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

export async function loadState(domain: string): Promise<ProvisioningState | null> {
  await connectToDatabase();
  const doc = await EmailProvisioning.findOne({ domain: domain.toLowerCase() }).select("+defaultMailboxPassword");
  return doc ? toState(doc) : null;
}

export async function saveState(state: ProvisioningState): Promise<void> {
  await connectToDatabase();
  await EmailProvisioning.findOneAndUpdate(
    { domain: state.domain.toLowerCase() },
    {
      domain: state.domain.toLowerCase(),
      workspaceId: state.customerId,
      defaultMailboxLocalPart: state.defaultMailboxLocalPart,
      defaultMailboxPassword: state.defaultMailboxPassword,
      defaultMailboxPasswordRevealed: state.defaultMailboxPasswordRevealed,
      steps: state.steps,
      errors: state.errors,
      oracleEmailDomainId: state.oracleEmailDomainId,
      oracleDkimId: state.oracleDkimId,
      oracleDkimCnameName: state.oracleDkimCnameName,
      oracleDkimCnameValue: state.oracleDkimCnameValue,
      oracleSenderId: state.oracleSenderId,
    },
    { upsert: true, new: true }
  );
}

/** All provisioning records for a workspace -- powers the /email/domains page. */
export async function loadStatesForWorkspace(workspaceId: string): Promise<ProvisioningState[]> {
  await connectToDatabase();
  const docs = await EmailProvisioning.find({ workspaceId }).select("+defaultMailboxPassword");
  return docs.map(toState);
}

/** Flips defaultMailboxPasswordRevealed to true so it's never sent to the
 * browser again after this. Called by GET /api/email/domains the one time
 * it includes the password in a response. */
export async function markPasswordRevealed(domain: string): Promise<void> {
  await connectToDatabase();
  await EmailProvisioning.updateOne({ domain: domain.toLowerCase() }, { defaultMailboxPasswordRevealed: true });
}
