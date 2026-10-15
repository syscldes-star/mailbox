// lib/bulk-email/campaigns.ts
//
// Combined results for campaigns: recipient totals summed across every
// send in a campaign (sent, opened, clicked, ...), plus how many of its
// emails are drafts, scheduled, sending or done.

import mongoose from "mongoose";
import { BulkEmailJob, EMPTY_COUNTS, type JobCounts } from "../models/BulkEmailJob";
import { Campaign } from "../models/Campaign";
import { EmailDraft } from "../models/EmailDraft";

export interface CampaignStats {
  /** Recipient totals across all the campaign's sends. */
  counts: JobCounts;
  /** Number of emails in each state. */
  emails: { drafts: number; scheduled: number; sending: number; sent: number; stopped: number };
  lastActivityAt?: Date;
}

function emptyStats(): CampaignStats {
  return { counts: { ...EMPTY_COUNTS }, emails: { drafts: 0, scheduled: 0, sending: 0, sent: 0, stopped: 0 } };
}

export async function campaignStats(workspaceId: string, campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map(campaignIds.map((id) => [id, emptyStats()]));
  if (campaignIds.length === 0) return out;

  const countKeys = Object.keys(EMPTY_COUNTS) as (keyof JobCounts)[];
  const [jobs, drafts] = await Promise.all([
    BulkEmailJob.aggregate<{ _id: { c: string; s: string }; n: number; last: Date } & Partial<Record<keyof JobCounts, number>>>([
      { $match: { workspaceId, campaignId: { $in: campaignIds }, status: { $ne: "preparing" } } },
      {
        $group: {
          _id: { c: "$campaignId", s: "$status" },
          n: { $sum: 1 },
          last: { $max: "$createdAt" },
          ...Object.fromEntries(countKeys.map((k) => [k, { $sum: `$counts.${k}` }])),
        },
      },
    ]),
    EmailDraft.aggregate<{ _id: string; n: number; last: Date }>([
      { $match: { workspaceId, campaignId: { $in: campaignIds } } },
      { $group: { _id: "$campaignId", n: { $sum: 1 }, last: { $max: "$updatedAt" } } },
    ]),
  ]);

  const touch = (s: CampaignStats, at?: Date) => {
    if (at && (!s.lastActivityAt || at > s.lastActivityAt)) s.lastActivityAt = at;
  };
  for (const row of jobs) {
    const s = out.get(row._id.c);
    if (!s) continue;
    const status = row._id.s;
    if (status === "scheduled") s.emails.scheduled += row.n;
    else if (status === "sending") s.emails.sending += row.n;
    else if (status === "completed") s.emails.sent += row.n;
    else s.emails.stopped += row.n;
    // Scheduled emails haven't gone out, so they don't count towards results yet.
    if (status !== "scheduled") for (const k of countKeys) s.counts[k] += row[k] ?? 0;
    touch(s, row.last);
  }
  for (const row of drafts) {
    const s = out.get(row._id);
    if (!s) continue;
    s.emails.drafts = row.n;
    touch(s, row.last);
  }
  return out;
}

/** The campaign if it exists in this workspace, else null. */
export async function findCampaign(workspaceId: string, id: unknown) {
  if (typeof id !== "string" || !mongoose.isValidObjectId(id)) return null;
  return Campaign.findOne({ _id: id, workspaceId }).lean();
}
