// app/api/email/campaigns/[id]/route.ts
//
// Session-cookie protected. GET returns one campaign with its combined
// results, its drafts and its sends; PUT renames it or changes its
// description; DELETE removes it along with its unsent drafts. Emails
// already sent stay in History, just no longer grouped.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { visibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { Campaign } from "@/lib/models/Campaign";
import { EmailDraft } from "@/lib/models/EmailDraft";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { campaignStats } from "@/lib/bulk-email/campaigns";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Campaign not found.", 404);

  const campaign = await Campaign.findOne({ _id: id, ...visibleTo(auth) }).lean();
  if (!campaign) return apiError("Campaign not found.", 404);

  const [stats, drafts, sends] = await Promise.all([
    campaignStats(auth.workspaceId, [id]),
    EmailDraft.find({ workspaceId: auth.workspaceId, campaignId: id })
      .sort({ updatedAt: -1 })
      .select("subject recipientCount updatedAt createdAt")
      .lean(),
    BulkEmailJob.find({ workspaceId: auth.workspaceId, campaignId: id, status: { $ne: "preparing" } })
      .sort({ createdAt: -1 })
      .select("subject status counts createdAt completedAt scheduledAt trackOpens trackClicks")
      .lean(),
  ]);

  return apiSuccess({
    id,
    name: campaign.name,
    description: campaign.description ?? "",
    createdAt: campaign.createdAt,
    ...stats.get(id)!,
    drafts: drafts.map((d) => ({ id: String(d._id), subject: d.subject, recipientCount: d.recipientCount, updatedAt: d.updatedAt })),
    sends: sends.map(({ _id, counts, ...rest }) => ({ id: String(_id), ...rest, ...counts })),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

async function authorizeWrite() {
  const auth = await requireAuth();
  if (!auth) return { error: apiError("Not authenticated.", 401) };
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return { error: apiError("Only managers, admins, and owners can change campaigns.", 403) };
  }
  return { auth };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { auth, error } = await authorizeWrite();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Campaign not found.", 404);

  const body = (await req.json()) as { name?: string; description?: string };
  const update: Record<string, string> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 120);
    if (!name) return apiError("Give the campaign a name.", 400);
    update.name = name;
  }
  if (body.description !== undefined) update.description = String(body.description).trim().slice(0, 500);
  const result = await Campaign.updateOne({ _id: id, ...visibleTo(auth!) }, { $set: update });
  if (result.matchedCount === 0) return apiError("Campaign not found.", 404);
  return apiSuccess({ id }, "Campaign saved.");
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { auth, error } = await authorizeWrite();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Campaign not found.", 404);

  const deleted = await Campaign.deleteOne({ _id: id, ...visibleTo(auth!) });
  if (deleted.deletedCount === 0) return apiError("Campaign not found.", 404);
  await Promise.all([
    EmailDraft.deleteMany({ workspaceId: auth!.workspaceId, campaignId: id }),
    BulkEmailJob.updateMany({ workspaceId: auth!.workspaceId, campaignId: id }, { $unset: { campaignId: 1 } }),
  ]);
  return apiSuccess({ id }, "Campaign deleted.");
}
