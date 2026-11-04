// app/api/email/bulk/stats/route.ts
//
// Session-cookie protected. Everything the Overview page shows:
// ?days=30|90|365, optional &campaignId= and &tz= (the viewer's UTC
// offset in minutes, so days are grouped in their own timezone).
// See lib/bulk-email/overview-stats.ts.

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { visibleTo, workVisibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { overviewStats } from "@/lib/bulk-email/overview-stats";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const q = req.nextUrl.searchParams;
  const days = Number(q.get("days")) || 30;
  if (days !== 30 && days !== 90 && days !== 365) return apiError("days must be 30, 90 or 365.", 400);
  const tz = Math.max(-14 * 60, Math.min(14 * 60, Math.round(Number(q.get("tz")) || 0)));

  return apiSuccess(
    await overviewStats({ workspaceId: auth.workspaceId, jobScope: await workVisibleTo(auth), listScope: visibleTo(auth), days, campaignId: q.get("campaignId") || undefined, tzOffset: tz })
  );
}
