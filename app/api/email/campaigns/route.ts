// app/api/email/campaigns/route.ts
//
// Session-cookie protected. GET lists the workspace's campaigns with
// their combined results; POST creates one.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { Campaign } from "@/lib/models/Campaign";
import { campaignStats } from "@/lib/bulk-email/campaigns";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const campaigns = await Campaign.find({ workspaceId: auth.workspaceId }).sort({ createdAt: -1 }).limit(500).lean();
  const stats = await campaignStats(auth.workspaceId, campaigns.map((c) => String(c._id)));
  return apiSuccess({
    campaigns: campaigns.map((c) => {
      const s = stats.get(String(c._id))!;
      return {
        id: String(c._id),
        name: c.name,
        description: c.description ?? "",
        createdAt: c.createdAt,
        lastActivityAt: s.lastActivityAt ?? c.updatedAt,
        ...s,
      };
    }),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can create campaigns.", 403);
  }
  const body = (await req.json()) as { name?: string; description?: string };
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return apiError("Give the campaign a name.", 400);
  const campaign = await Campaign.create({
    workspaceId: auth.workspaceId,
    name,
    description: String(body.description ?? "").trim().slice(0, 500) || undefined,
    createdBy: auth.userId,
  });
  return apiSuccess({ id: String(campaign._id), name: campaign.name }, "Campaign created.", 201);
}
