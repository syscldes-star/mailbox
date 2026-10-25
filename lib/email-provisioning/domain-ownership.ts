// lib/email-provisioning/domain-ownership.ts
//
// Confirms a domain is legitimately usable by the requesting workspace
// before we let them provision real email infrastructure for it --
// otherwise anyone with access to /email/domains could type in ANY
// domain (including ones they don't own) and have this service create
// real Oracle Email Delivery / DKIM / Mailcow resources for it.
//
// For automatic (Vercel DNS) setup, a domain must be a verified custom
// domain connected to one of the workspace's own websites. Domains that
// aren't connected to any site ("not_connected") can still be set up with
// manual DNS, which proves ownership with a TXT record instead.

import { connectToDatabase } from "../db/mongodb";
import { Website } from "../models/Website";
import { CustomDomain } from "../models/CustomDomain";

export async function assertDomainOwnedByWorkspace(
  domain: string,
  workspaceId: string
): Promise<{ allowed: true } | { allowed: false; code: "not_connected" | "unverified" | "other_workspace"; reason: string }> {
  await connectToDatabase();
  const normalized = domain.toLowerCase().trim();

  const customDomain = await CustomDomain.findOne({ domain: normalized });
  if (!customDomain) {
    return { allowed: false, code: "not_connected", reason: `${normalized} isn't connected to any of your websites yet.` };
  }
  if (!customDomain.vercelVerified) {
    return { allowed: false, code: "unverified", reason: `${normalized} hasn't finished domain verification yet.` };
  }
  const website = await Website.findOne({ _id: customDomain.websiteId, workspaceId });
  if (!website) {
    return { allowed: false, code: "other_workspace", reason: `${normalized} doesn't belong to your workspace.` };
  }
  return { allowed: true };
}
