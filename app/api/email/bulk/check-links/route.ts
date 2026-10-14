// app/api/email/bulk/check-links/route.ts
//
// Session-cookie protected. POST {urls} checks each link in a draft
// (with SSRF protection -- see lib/bulk-email/link-check.ts).

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { checkLinks } from "@/lib/bulk-email/link-check";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

const MAX_LINKS = 40;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can check links.", 403);
  }
  const { urls } = await req.json();
  if (!Array.isArray(urls)) return apiError("urls must be a list.", 400);
  const candidates = [...new Set(urls.map(String).filter((u) => /^https?:\/\//i.test(u) && !u.includes("{{")))];
  if (candidates.length > MAX_LINKS) return apiError(`Check at most ${MAX_LINKS} links at once.`, 400);
  return apiSuccess({ results: await checkLinks(candidates) });
}
