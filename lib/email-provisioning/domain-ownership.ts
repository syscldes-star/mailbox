// lib/email-provisioning/domain-ownership.ts
//
// Confirms a domain is legitimately usable by the requesting workspace
// before we let them provision real email infrastructure for it --
// otherwise anyone with access to /email/domains could type in ANY
// domain (including ones they don't own) and have this service create
// real Oracle Email Delivery / DKIM / Mailcow resources for it.
//
// Custom domains only -- a domain must be a verified custom domain
// connected to one of the workspace's own websites.

import { connectToDatabase } from "../db/mongodb";
import { Website } from "../models/Website";
import { CustomDomain } from "../models/CustomDomain";

export async function assertDomainOwnedByWorkspace(
  domain: string,
  workspaceId: string
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  await connectToDatabase();
  const normalized = domain.toLowerCase().trim();

  const customDomain = await CustomDomain.findOne({ domain: normalized });
  if (!customDomain) {
    return { allowed: false, reason: `${normalized} isn't connected to any of your websites yet.` };
  }
  if (!customDomain.vercelVerified) {
    return { allowed: false, reason: `${normalized} hasn't finished domain verification yet.` };
  }
  const website = await Website.findOne({ _id: customDomain.websiteId, workspaceId });
  if (!website) {
    return { allowed: false, reason: `${normalized} doesn't belong to your workspace.` };
  }
  return { allowed: true };
}
