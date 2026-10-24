// app/api/email/bulk/[id]/clickmap/route.ts
//
// Session-cookie protected. GET returns the send's email with a click
// badge on every link (for a sandboxed preview frame), plus the per-link
// numbers behind it.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/api/requireAuth";
import { workVisibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { clickMapHtml, clicksByUrl, matchClicks, templateLinks } from "@/lib/bulk-email/link-stats";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Bulk send not found.", 404);

  const job = await BulkEmailJob.findOne({ _id: id, ...(await workVisibleTo(auth!)) }).select("bodyHtml counts trackClicks subject").lean();
  if (!job) return apiError("Bulk send not found.", 404);

  const links = templateLinks(job.bodyHtml);
  const { stats, other } = matchClicks(links, await clicksByUrl([id]));
  return apiSuccess({
    subject: job.subject,
    trackClicks: job.trackClicks !== false,
    sent: job.counts?.sent ?? 0,
    clicked: job.counts?.clicked ?? 0,
    html: clickMapHtml(job.bodyHtml, stats, job.counts?.sent ?? 0),
    links: stats,
    other,
  });
}
