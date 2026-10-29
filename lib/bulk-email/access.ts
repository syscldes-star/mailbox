// lib/bulk-email/access.ts
//
// Request-side helpers shared by the /api/email/bulk routes.

import type { NextRequest } from "next/server";
import { mailcowListMailboxes } from "../email-provisioning/mailcow-client";
import { loadStatesForWorkspace } from "../email-provisioning/state-store";

/** A domain this workspace can send from: provisioned AND with an active
 * Oracle approved sender (the wildcard @domain sender). */
export interface SenderDomain {
  domain: string;
  defaultLocalPart: string;
  /** Local parts of the domain's webmail mailboxes -- the only addresses
   * bulk email may be sent from, so replies always reach a real inbox.
   * null when Mailcow couldn't be reached. */
  mailboxes: string[] | null;
}

/** Mailbox lists change rarely; cache them briefly so every Compose load
 * doesn't hit Mailcow. */
const mailboxCache = new Map<string, { at: number; list: string[] }>();
const MAILBOX_CACHE_MS = 60_000;

export async function mailboxLocalParts(domain: string, fresh = false): Promise<string[] | null> {
  const hit = mailboxCache.get(domain);
  if (!fresh && hit && Date.now() - hit.at < MAILBOX_CACHE_MS) return hit.list;
  try {
    const list = (await mailcowListMailboxes(domain))
      .filter((m: { active?: string | number }) => String(m.active ?? "1") !== "0")
      .map((m: { local_part?: string; username?: string }) => (m.local_part ?? String(m.username ?? "").split("@")[0]).toLowerCase())
      .filter(Boolean)
      .sort();
    mailboxCache.set(domain, { at: Date.now(), list });
    return list;
  } catch (err) {
    console.error(`[bulk-email] couldn't list mailboxes for ${domain}`, err);
    return null;
  }
}

/** Domains this workspace can send from (approved at Oracle), each with
 * its mailboxes. */
export async function loadSenderDomains(workspaceId: string): Promise<SenderDomain[]> {
  const states = (await loadStatesForWorkspace(workspaceId)).filter((s) => s.steps.oracle_sender === "done");
  return Promise.all(
    states.map(async (s) => ({ domain: s.domain, defaultLocalPart: s.defaultMailboxLocalPart, mailboxes: await mailboxLocalParts(s.domain) }))
  );
}

/** Why `local@domain` can't be used as a From address, or null if it can:
 * the domain must be ready to send, and the address must be one of its
 * webmail mailboxes. */
export async function senderProblem(workspaceId: string, domain: string, localPart: string): Promise<string | null> {
  const senders = await loadSenderDomains(workspaceId);
  const sender = senders.find((s) => s.domain === domain);
  if (!sender) return "That domain isn't ready to send from yet (it needs an active approved sender).";
  // A just-created mailbox may not be in the cache yet.
  const mailboxes = sender.mailboxes?.includes(localPart) ? sender.mailboxes : await mailboxLocalParts(domain, true);
  if (mailboxes === null) return "Couldn't check your mailboxes right now -- please try again in a minute.";
  if (!mailboxes.includes(localPart)) {
    return `${localPart}@${domain} isn't a webmail mailbox. Send from one of your mailboxes (create one under Mailbox → Mailboxes), so replies reach a real inbox.`;
  }
  return null;
}

/** Base URL recipients' unsubscribe links should point at. Prefer the
 * explicit env var -- behind pm2/nginx the request's own origin may be
 * an internal localhost address. */
export function publicBaseUrl(req: NextRequest): string {
  if (process.env.EMAIL_SERVICE_PUBLIC_URL) return process.env.EMAIL_SERVICE_PUBLIC_URL;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

export const LOCAL_PART_PATTERN = /^[a-z0-9._%+-]+$/i;
export const MIN_SEND_ROLE = "manager";
