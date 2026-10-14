// app/api/email/bulk/stats/route.ts
//
// Session-cookie protected. Totals and weekly trend across the
// workspace's bulk sends for the Overview tab. ?days=30|90|365.
//
// Open and click rates only count sends that had that tracking switched
// on, so untracked sends don't drag the rates toward zero.

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { EmailSuppression } from "@/lib/models/EmailSuppression";

const ALLOWED_DAYS = [30, 90, 365];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const countWhere = (cond: object) => ({ $size: { $filter: { input: "$recipients", cond } } });
const isSet = (field: string) => ({ $ne: [{ $ifNull: [`$$this.${field}`, null] }, null] });

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const days = Number(req.nextUrl.searchParams.get("days")) || 30;
  if (!ALLOWED_DAYS.includes(days)) return apiError("days must be 30, 90 or 365.", 400);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [jobs, unsubscribes] = await Promise.all([
    BulkEmailJob.aggregate<{
      _id: unknown;
      subject: string;
      createdAt: Date;
      trackOpens?: boolean;
      trackClicks?: boolean;
      sent: number;
      opened: number;
      clicked: number;
      bounced: number;
      complained: number;
    }>([
      { $match: { workspaceId: auth.workspaceId, createdAt: { $gte: since }, status: { $ne: "scheduled" } } },
      { $sort: { createdAt: -1 } },
      {
        $project: {
          subject: 1,
          createdAt: 1,
          trackOpens: 1,
          trackClicks: 1,
          sent: countWhere({ $eq: ["$$this.status", "sent"] }),
          opened: countWhere(isSet("openedAt")),
          clicked: countWhere(isSet("clickedAt")),
          bounced: countWhere({ $in: [{ $ifNull: ["$$this.deliveryIssue", null] }, ["bounced", "soft_bounced"]] }),
          complained: countWhere({ $eq: ["$$this.deliveryIssue", "complained"] }),
        },
      },
    ]),
    EmailSuppression.countDocuments({ workspaceId: auth.workspaceId, reason: "unsubscribed", createdAt: { $gte: since } }),
  ]);

  let sent = 0, opened = 0, clicked = 0, bounced = 0, complained = 0, openBase = 0, clickBase = 0;
  for (const j of jobs) {
    sent += j.sent;
    bounced += j.bounced;
    complained += j.complained;
    if (j.trackOpens) {
      opened += j.opened;
      openBase += j.sent;
    }
    if (j.trackClicks) {
      clicked += j.clicked;
      clickBase += j.sent;
    }
  }

  // Weekly buckets, oldest first, covering the whole range (empty weeks included).
  const weekCount = Math.ceil(days / 7);
  const start = Date.now() - weekCount * WEEK_MS;
  const weeks = Array.from({ length: weekCount }, (_, i) => ({ weekStart: new Date(start + i * WEEK_MS), sent: 0, opened: 0, clicked: 0 }));
  for (const j of jobs) {
    const i = Math.min(weekCount - 1, Math.max(0, Math.floor((new Date(j.createdAt).getTime() - start) / WEEK_MS)));
    weeks[i].sent += j.sent;
    if (j.trackOpens) weeks[i].opened += j.opened;
    if (j.trackClicks) weeks[i].clicked += j.clicked;
  }

  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  return apiSuccess({
    days,
    totals: {
      sends: jobs.length,
      sent,
      openRate: rate(opened, openBase),
      clickRate: rate(clicked, clickBase),
      bounceRate: rate(bounced, sent),
      complaintRate: rate(complained, sent),
      unsubscribes,
    },
    weeks,
    recent: jobs.slice(0, 10).map((j) => ({
      id: String(j._id),
      subject: j.subject,
      createdAt: j.createdAt,
      sent: j.sent,
      openRate: j.trackOpens ? rate(j.opened, j.sent) : null,
      clickRate: j.trackClicks ? rate(j.clicked, j.sent) : null,
      bounced: j.bounced,
    })),
  });
}
