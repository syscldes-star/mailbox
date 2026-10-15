// lib/bulk-email/engagement.ts
//
// How engaged each recipient is, from the sends of the last `days` days
// that had open tracking on:
//   engaged  -- opened or clicked in the last 30 days
//   active   -- opened or clicked earlier in the window
//   inactive -- got at least `minSends` emails in the window and never
//               opened or clicked any of them
//   new      -- too few emails so far to judge
// Score (0-100): the share of their emails they opened, with clicks
// counting double.

import { BulkEmailJob } from "../models/BulkEmailJob";
import { BulkRecipient } from "../models/BulkRecipient";
import { EmailSuppression } from "../models/EmailSuppression";

export type Segment = "engaged" | "active" | "inactive" | "new";
export const SEGMENTS: Segment[] = ["engaged", "active", "inactive", "new"];

export interface EngagementRow {
  email: string;
  name?: string;
  received: number;
  opened: number;
  clicked: number;
  lastSentAt?: Date;
  lastEngagedAt?: Date;
  score: number;
  segment: Segment;
}

export interface EngagementOptions {
  days: number;
  minSends: number;
}

export function cleanOptions(input: { days?: unknown; minSends?: unknown }): EngagementOptions {
  const days = Math.min(365, Math.max(14, Math.round(Number(input.days) || 90)));
  const minSends = Math.min(20, Math.max(1, Math.round(Number(input.minSends) || 3)));
  return { days, minSends };
}

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/** Everyone emailed in the window (excluding addresses already on the
 * do-not-email list), with their segment and score. */
export async function computeEngagement(workspaceId: string, { days, minSends }: EngagementOptions) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const jobIds = (
    await BulkEmailJob.find({ workspaceId, trackOpens: true, createdAt: { $gte: since }, status: { $nin: ["preparing", "scheduled"] } })
      .select("_id")
      .lean()
  ).map((j) => j._id);

  const rows =
    jobIds.length === 0
      ? []
      : await BulkRecipient.aggregate<{
          _id: string;
          name?: string;
          received: number;
          opened: number;
          clicked: number;
          lastSentAt?: Date;
          lastOpenAt?: Date;
          lastClickAt?: Date;
        }>([
          { $match: { jobId: { $in: jobIds }, status: "sent" } },
          {
            $group: {
              _id: "$email",
              name: { $last: "$name" },
              received: { $sum: 1 },
              opened: { $sum: { $cond: [{ $ifNull: ["$openedAt", false] }, 1, 0] } },
              clicked: { $sum: { $cond: [{ $ifNull: ["$clickedAt", false] }, 1, 0] } },
              lastSentAt: { $max: "$sentAt" },
              lastOpenAt: { $max: { $ifNull: ["$lastOpenedAt", "$openedAt"] } },
              lastClickAt: { $max: { $ifNull: ["$lastClickedAt", "$clickedAt"] } },
            },
          },
        ]).allowDiskUse(true);

  const stopped = new Set(
    (await EmailSuppression.find({ workspaceId, email: { $in: rows.map((r) => r._id) } }).select("email").lean()).map((s) => s.email)
  );

  const now = Date.now();
  const people: EngagementRow[] = [];
  for (const r of rows) {
    if (stopped.has(r._id)) continue;
    const lastEngagedAt = [r.lastOpenAt, r.lastClickAt].filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? undefined;
    // A click without a recorded open (images blocked) still counts as engagement.
    const engagedEmails = Math.max(r.opened, r.clicked);
    const segment: Segment = lastEngagedAt
      ? now - +lastEngagedAt <= RECENT_MS
        ? "engaged"
        : "active"
      : r.received >= minSends
        ? "inactive"
        : "new";
    const score = Math.min(100, Math.round((100 * (engagedEmails + r.clicked)) / (2 * r.received)));
    people.push({
      email: r._id,
      name: r.name || undefined,
      received: r.received,
      opened: r.opened,
      clicked: r.clicked,
      lastSentAt: r.lastSentAt,
      lastEngagedAt,
      score,
      segment,
    });
  }

  const summary = Object.fromEntries(SEGMENTS.map((s) => [s, 0])) as Record<Segment, number>;
  for (const p of people) summary[p.segment]++;
  return { people, summary, alreadyStopped: stopped.size, trackedSends: jobIds.length };
}
