// app/api/email/domains/[domain]/route.ts
//
// Session-cookie protected. GET lists the DNS records the domain needs,
// each checked live ("found" or not) -- shown to manual-DNS customers as
// the records to copy, and to everyone in Domain Health.
// POST {action:"check"} re-runs setup from wherever it stopped (a step
// waiting for DNS, or a failed step); {action:"return_path"} adds the
// custom return path to a domain set up before that step existed.

import { NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { loadState, saveState } from "@/lib/email-provisioning/state-store";
import { provisionDomainEmail } from "@/lib/email-provisioning/provision-domain";
import { dnsRecordsFor } from "@/lib/email-provisioning/dns-records";

type Params = { params: Promise<{ domain: string }> };

async function ownState(domain: string, workspaceId: string) {
  const state = await loadState(decodeURIComponent(domain).toLowerCase());
  return state && state.customerId === workspaceId ? state : null;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const state = await ownState((await params).domain, auth.workspaceId);
  if (!state) return apiError("Domain not found for this workspace.", 404);
  return apiSuccess({ dnsMode: state.dnsMode ?? "vercel", records: await dnsRecordsFor(state) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const state = await ownState((await params).domain, auth.workspaceId);
  if (!state) return apiError("Domain not found for this workspace.", 404);

  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "check" && action !== "return_path") return apiError("Unknown action.", 400);

  if (action === "return_path") {
    for (const step of ["oracle_return_path", "dns_return_path", "return_path_active"] as const) {
      if (state.steps[step] !== "done") state.steps[step] = "pending";
    }
    await saveState(state);
  }
  // Failed steps are retried; "waiting" ones are re-checked.
  waitUntil(provisionDomainEmail(state.domain, state.customerId, state.defaultMailboxLocalPart, "", loadState, saveState));
  return apiSuccess({ domain: state.domain }, action === "check" ? "Checking now…" : "Setting up the return path…");
}
