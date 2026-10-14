// app/api/email/domain-health/route.ts
//
// Session-cookie protected. GET ?domain=x runs the live DNS/Oracle health
// check for one of this workspace's domains.

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { loadState } from "@/lib/email-provisioning/state-store";
import { checkDomainHealth } from "@/lib/bulk-email/domain-health";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const domain = req.nextUrl.searchParams.get("domain")?.trim().toLowerCase();
  if (!domain) return apiError("domain query param required.", 400);
  const state = await loadState(domain);
  if (!state || state.customerId !== auth.workspaceId) return apiError("Domain not found for this workspace.", 404);

  const checks = await checkDomainHealth(state);
  const level = checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warning") ? "warning" : "ok";
  return apiSuccess({ domain, level, checks, checkedAt: new Date().toISOString() });
}
