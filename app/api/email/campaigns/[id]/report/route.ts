// app/api/email/campaigns/[id]/report/route.ts
//
// Session-cookie protected. GET returns everything the campaign report
// shows: combined results, each send's numbers, and the most-clicked
// links across all of its emails.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/api/requireAuth";
import { visibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { Campaign } from "@/lib/models/Campaign";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { campaignStats } from "@/lib/bulk-email/campaigns";
import { clicksByUrl, linkKey, matchClicks, templateLinks } from "@/lib/bulk-email/link-stats";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Campaign not found.", 404);

  const campaign = await Campaign.findOne({ _id: id, ...visibleTo(auth) }).lean();
  if (!campaign) return apiError("Campaign not found.", 404);

  const [stats, sends] = await Promise.all([
    campaignStats(auth.workspaceId, [id]),
    BulkEmailJob.find({ workspaceId: auth.workspaceId, campaignId: id, status: { $nin: ["preparing", "scheduled"] } })
      .sort({ createdAt: 1 })
      .select("subject status counts createdAt completedAt bodyHtml fromDomain fromLocalPart")
      .lean(),
  ]);

  // Top links across every send: clicks grouped by link, labelled with
  // the link text from the email it appeared in.
  const top = new Map<string, { label: string; url: string; clickers: number; emails: Set<string> }>();
  for (const s of sends) {
    const { stats: perLink } = matchClicks(templateLinks(s.bodyHtml), await clicksByUrl([String(s._id)]));
    const seen = new Set<string>();
    for (const l of perLink) {
      const key = linkKey(l.href);
      if (seen.has(key)) continue; // same address twice in one email shares its clicks
      seen.add(key);
      const entry = top.get(key) ?? { label: l.label, url: l.href, clickers: 0, emails: new Set<string>() };
      entry.clickers += l.clickers;
      entry.emails.add(s.subject);
      top.set(key, entry);
    }
  }

  return apiSuccess({
    name: campaign.name,
    description: campaign.description ?? "",
    createdAt: campaign.createdAt,
    generatedAt: new Date(),
    ...stats.get(id)!,
    sends: sends.map((s) => ({
      id: String(s._id),
      subject: s.subject,
      status: s.status,
      from: `${s.fromLocalPart}@${s.fromDomain}`,
      date: s.completedAt ?? s.createdAt,
      ...s.counts,
    })),
    topLinks: [...top.values()]
      .sort((a, b) => b.clickers - a.clickers)
      .slice(0, 20)
      .map((l) => ({ label: l.label, url: l.url, clickers: l.clickers, emails: [...l.emails] })),
  });
}
