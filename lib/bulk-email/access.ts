// lib/bulk-email/access.ts
//
// Request-side helpers shared by the /api/email/bulk routes.

import type { NextRequest } from "next/server";
import { loadStatesForWorkspace } from "../email-provisioning/state-store";

/** Domains this workspace can send from: provisioned AND with an active
 * Oracle approved sender (the wildcard @domain sender). */
export async function loadSenderDomains(workspaceId: string) {
  const states = await loadStatesForWorkspace(workspaceId);
  return states
    .filter((s) => s.steps.oracle_sender === "done")
    .map((s) => ({ domain: s.domain, defaultLocalPart: s.defaultMailboxLocalPart }));
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
