// lib/bulk-email/overview-stats.ts
//
// Everything the Overview page shows for a period (30 days, 90 days or
// 12 months), optionally for one campaign:
//   - totals, plus the same totals for the period before (for ▲/▼)
//   - opens and clicks over time: rates by send date, and by activity
//     date (when people actually opened or clicked)
//   - list growth: signups confirmed vs people who left, and why
//   - best emails: top open rate, top click rate, most unsubscribes
//   - a one-line insight (best weekday to send)
// Days are grouped in the viewer's timezone (tzOffset, minutes east of UTC).

import mongoose from "mongoose";
import { BulkEmailJob, type JobCounts } from "../models/BulkEmailJob";
import { BulkRecipient } from "../models/BulkRecipient";
import { ContactList } from "../models/ContactList";
import { EmailSuppression } from "../models/EmailSuppression";
import { Campaign } from "../models/Campaign";
import { clicksByUrl, matchClicks, templateLinks } from "./link-stats";

const DAY = 24 * 60 * 60 * 1000;
/** Emails sent to fewer people than this aren't ranked as "best" -- a
 * 2-person test send would otherwise top every list. */
export const MIN_RANKED_RECIPIENTS = 20;

export interface OverviewOptions {
  workspaceId: string;
  /** Which sends count (lib/visibility.ts workVisibleTo): the whole
   * workspace for the owner, a member's own / shared-campaign sends. */
  jobScope: Record<string, unknown>;
  /** Which lists count towards list growth (lib/visibility.ts visibleTo). */
  listScope: Record<string, unknown>;
  days: 30 | 90 | 365;
  campaignId?: string;
  tzOffset: number;
}

type Job = JobCounts & {
  _id: mongoose.Types.ObjectId;
  subject: string;
  createdAt: Date;
  trackOpens?: boolean;
  trackClicks?: boolean;
  campaignId?: string;
  bodyHtml?: string;
};

function totalsOf(jobs: Job[]) {
  let sent = 0, opened = 0, clicked = 0, bounced = 0, complained = 0, unsubscribed = 0, openBase = 0, clickBase = 0;
  for (const j of jobs) {
    sent += j.sent;
    bounced += j.bounced;
    complained += j.complained;
    unsubscribed += j.unsubscribed ?? 0;
    if (j.trackOpens) {
      opened += j.opened;
      openBase += j.sent;
    }
    if (j.trackClicks) {
      clicked += j.clicked;
      clickBase += j.sent;
    }
  }
  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  return {
    sends: jobs.length,
    sent,
    openRate: rate(opened, openBase),
    clickRate: rate(clicked, clickBase),
    bounceRate: rate(bounced, sent),
    complaintRate: rate(complained, sent),
    unsubscribed,
  };
}

export async function overviewStats({ workspaceId, jobScope, listScope, days, campaignId, tzOffset }: OverviewOptions) {
  const now = Date.now();
  const tz = tzOffset * 60 * 1000;
  // Buckets: one per day for 30 days, one per week otherwise. They end at
  // the end of today (viewer's time), so the last bucket is "today"/"this week".
  const bucketMs = days === 30 ? DAY : 7 * DAY;
  const bucketCount = Math.ceil(days / (bucketMs / DAY));
  const endOfToday = Math.floor((now + tz) / DAY) * DAY + DAY - tz;
  const start = endOfToday - bucketCount * bucketMs;
  const prevStart = start - bucketCount * bucketMs;
  const bucketOf = (t: number) => Math.floor((t - start) / bucketMs);
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    start: new Date(start + i * bucketMs),
    end: new Date(start + (i + 1) * bucketMs - 1),
  }));

  const campaignFilter = campaignId && mongoose.isValidObjectId(campaignId) ? { campaignId } : {};
  const jobFields = "subject createdAt trackOpens trackClicks campaignId counts";
  const loadJobs = (from: number, to: number) =>
    BulkEmailJob.find({
      ...jobScope,
      ...campaignFilter,
      createdAt: { $gte: new Date(from), $lt: new Date(to) },
      status: { $nin: ["scheduled", "preparing"] },
    })
      .select(jobFields)
      .lean()
      .then((docs) => docs.map(({ counts, ...rest }) => ({ ...rest, ...counts }) as unknown as Job));

  const [jobs, prevJobs] = await Promise.all([loadJobs(start, endOfToday), loadJobs(prevStart, start)]);

  // ---- Opens and clicks over time ----
  const timeline = buckets.map((b) => ({
    ...b,
    sent: 0,
    opened: 0,
    clicked: 0,
    openBase: 0,
    clickBase: 0,
    emails: [] as string[],
    activityOpens: 0,
    activityClicks: 0,
  }));
  for (const j of jobs) {
    const t = timeline[bucketOf(new Date(j.createdAt).getTime())];
    if (!t) continue;
    t.sent += j.sent;
    t.emails.push(j.subject);
    if (j.trackOpens) {
      t.opened += j.opened;
      t.openBase += j.sent;
    }
    if (j.trackClicks) {
      t.clicked += j.clicked;
      t.clickBase += j.sent;
    }
  }

  // Activity date: first opens / first clicks that happened in each bucket,
  // whichever email they came from (older emails opened late count too).
  const recipientScope: Record<string, unknown> = { workspaceId };
  const scopedToSomeSends = campaignFilter.campaignId || "$or" in jobScope;
  if (scopedToSomeSends) {
    const ids = await BulkEmailJob.find({ ...jobScope, ...campaignFilter }).distinct("_id");
    recipientScope.jobId = { $in: ids };
  }
  const activity = async (field: "openedAt" | "clickedAt") =>
    BulkRecipient.aggregate<{ _id: number; n: number }>([
      { $match: { ...recipientScope, [field]: { $gte: new Date(start), $lt: new Date(endOfToday) } } },
      { $group: { _id: { $floor: { $divide: [{ $subtract: [{ $toLong: `$${field}` }, start] }, bucketMs] } }, n: { $sum: 1 } } },
    ]);
  const [openActivity, clickActivity] = await Promise.all([activity("openedAt"), activity("clickedAt")]);
  for (const r of openActivity) if (timeline[r._id]) timeline[r._id].activityOpens = r.n;
  for (const r of clickActivity) if (timeline[r._id]) timeline[r._id].activityClicks = r.n;

  // ---- List growth (workspace-wide; signups aren't tied to a campaign) ----
  const growthFor = async (from: number, to: number) => {
    const [joins, leaves] = await Promise.all([
      ContactList.aggregate<{ _id: { t: string; form?: string } }>([
        { $match: listScope },
        { $unwind: "$contacts" },
        {
          $match: {
            "contacts.vars.signup_form": { $exists: true },
            "contacts.vars.subscribed_at": { $gte: new Date(from).toISOString(), $lt: new Date(to).toISOString() },
          },
        },
        { $project: { _id: { t: "$contacts.vars.subscribed_at", form: "$contacts.vars.signup_form" } } },
      ]),
      EmailSuppression.find({ workspaceId, createdAt: { $gte: new Date(from), $lt: new Date(to) } })
        .select("reason createdAt")
        .lean(),
    ]);
    return { joins: joins.map((j) => ({ t: Date.parse(j._id.t), form: j._id.form ?? "Signup form" })), leaves };
  };
  const [growth, prevGrowth] = await Promise.all([growthFor(start, endOfToday), growthFor(prevStart, start)]);
  const growthBuckets = buckets.map((b) => ({
    ...b,
    joined: 0,
    left: 0,
    leftBy: { unsubscribed: 0, bounced: 0, complained: 0, inactive: 0, manual: 0 } as Record<string, number>,
  }));
  for (const j of growth.joins) {
    const g = growthBuckets[bucketOf(j.t)];
    if (g) g.joined++;
  }
  for (const l of growth.leaves) {
    const g = growthBuckets[bucketOf(new Date(l.createdAt).getTime())];
    if (!g) continue;
    g.left++;
    g.leftBy[l.reason] = (g.leftBy[l.reason] ?? 0) + 1;
  }
  const byForm = new Map<string, number>();
  for (const j of growth.joins) byForm.set(j.form, (byForm.get(j.form) ?? 0) + 1);
  const leftByReason: Record<string, number> = {};
  for (const l of growth.leaves) leftByReason[l.reason] = (leftByReason[l.reason] ?? 0) + 1;

  // ---- Best emails ----
  const ranked = jobs.filter((j) => j.sent >= MIN_RANKED_RECIPIENTS);
  const top = (pick: (j: Job) => number | null) =>
    ranked
      .map((j) => ({ j, v: pick(j) }))
      .filter((x): x is { j: Job; v: number } => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 5)
      .map((x) => x.j);
  const bestOpen = top((j) => (j.trackOpens ? j.opened / j.sent : null));
  const bestClick = top((j) => (j.trackClicks ? j.clicked / j.sent : null));
  const mostUnsub = top((j) => j.unsubscribed ?? 0);

  const shown = [...new Map([...bestOpen, ...bestClick, ...mostUnsub].map((j) => [String(j._id), j])).values()];
  const [bodies, campaigns] = await Promise.all([
    BulkEmailJob.find({ _id: { $in: shown.map((j) => j._id) } }).select("bodyHtml").lean(),
    Campaign.find({ workspaceId, _id: { $in: shown.map((j) => j.campaignId).filter((c) => c && mongoose.isValidObjectId(c)) } })
      .select("name")
      .lean(),
  ]);
  const bodyOf = new Map(bodies.map((b) => [String(b._id), b.bodyHtml]));
  const campaignName = new Map(campaigns.map((c) => [String(c._id), c.name]));
  const topLink = new Map<string, string | null>();
  await Promise.all(
    shown.map(async (j) => {
      if (!j.trackClicks || !j.clicked) return topLink.set(String(j._id), null);
      const { stats } = matchClicks(templateLinks(bodyOf.get(String(j._id)) ?? ""), await clicksByUrl([String(j._id)]));
      const best = [...stats].sort((a, b) => b.clickers - a.clickers)[0];
      topLink.set(String(j._id), best && best.clickers > 0 ? best.label : null);
    })
  );
  const row = (j: Job) => ({
    id: String(j._id),
    subject: j.subject,
    createdAt: j.createdAt,
    campaign: j.campaignId ? campaignName.get(j.campaignId) ?? null : null,
    sent: j.sent,
    openRate: j.trackOpens ? j.opened / j.sent : null,
    clickRate: j.trackClicks ? j.clicked / j.sent : null,
    unsubscribed: j.unsubscribed ?? 0,
    topLink: topLink.get(String(j._id)) ?? null,
  });

  // ---- Insight: best weekday to send (viewer's timezone) ----
  let insight: string | null = null;
  const tracked = jobs.filter((j) => j.trackOpens && j.sent >= MIN_RANKED_RECIPIENTS);
  if (tracked.length >= 4) {
    const byDay = new Map<number, { opened: number; sent: number; sends: number }>();
    let opened = 0, sent = 0;
    for (const j of tracked) {
      const day = new Date(new Date(j.createdAt).getTime() + tz).getUTCDay();
      const d = byDay.get(day) ?? { opened: 0, sent: 0, sends: 0 };
      d.opened += j.opened;
      d.sent += j.sent;
      d.sends++;
      byDay.set(day, d);
      opened += j.opened;
      sent += j.sent;
    }
    const avg = sent ? opened / sent : 0;
    const best = [...byDay.entries()].filter(([, d]) => d.sends >= 2).sort((a, b) => b[1].opened / b[1].sent - a[1].opened / a[1].sent)[0];
    if (best && avg > 0) {
      const ratio = best[1].opened / best[1].sent / avg;
      if (ratio >= 1.2) {
        const name = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][best[0]];
        insight = `Emails sent on ${name} get ${ratio.toFixed(1)}× your average open rate (${best[1].sends} sends).`;
      }
    }
  }

  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  return {
    days,
    bucket: bucketMs === DAY ? ("day" as const) : ("week" as const),
    totals: totalsOf(jobs),
    previous: totalsOf(prevJobs),
    timeline: timeline.map((t) => ({
      start: t.start,
      end: t.end,
      sent: t.sent,
      opened: t.opened,
      clicked: t.clicked,
      openRate: rate(t.opened, t.openBase),
      clickRate: rate(t.clicked, t.clickBase),
      emails: t.emails.slice(0, 5),
      emailCount: t.emails.length,
      activityOpens: t.activityOpens,
      activityClicks: t.activityClicks,
    })),
    growth: {
      joined: growth.joins.length,
      left: growth.leaves.length,
      previousJoined: prevGrowth.joins.length,
      previousLeft: prevGrowth.leaves.length,
      previousUnsubscribed: prevGrowth.leaves.filter((l) => l.reason === "unsubscribed").length,
      leftByReason,
      byForm: [...byForm.entries()].map(([form, joined]) => ({ form, joined })).sort((a, b) => b.joined - a.joined),
      buckets: growthBuckets,
    },
    best: { open: bestOpen.map(row), click: bestClick.map(row), unsubscribed: mostUnsub.map(row) },
    insight,
  };
}
