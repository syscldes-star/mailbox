// lib/email-provisioning/resume.ts
//
// Re-runs setup for domains paused on a "waiting" step (a DNS record the
// customer hasn't added yet, or that Oracle hasn't detected). Called by
// the scheduler every few minutes. Gives up re-checking after 14 days --
// the customer can still press "Check now".

import { EmailProvisioning } from "../models/EmailProvisioning";
import { provisionDomainEmail } from "./provision-domain";
import { loadState, saveState } from "./state-store";
import type { ProvisioningStep } from "./types";

const STEPS: ProvisioningStep[] = [
  "ownership_verified",
  "dns_dkim_cname",
  "dns_mail_records",
  "oracle_dkim_active",
  "dns_return_path",
  "return_path_active",
];

export async function resumeWaitingDomains(): Promise<void> {
  const docs = await EmailProvisioning.find({
    $or: STEPS.map((s) => ({ [`steps.${s}`]: "waiting" })),
    createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
  })
    .select("domain workspaceId defaultMailboxLocalPart")
    .lean();
  // One at a time: each run makes a few DNS and Oracle calls.
  for (const d of docs) {
    await provisionDomainEmail(d.domain, d.workspaceId, d.defaultMailboxLocalPart, "", loadState, saveState).catch((err) =>
      console.error(`[domains] re-check of ${d.domain} failed`, err)
    );
  }
}
