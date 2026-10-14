// lib/bulk-email/settings.ts
//
// Workspace settings and the rolling 24-hour sending limit.

import { BulkEmailJob } from "../models/BulkEmailJob";
import { EmailSettings } from "../models/EmailSettings";

/** Default per-workspace limit when the workspace hasn't set its own. */
export const DEFAULT_DAILY_LIMIT = Math.max(1, Number(process.env.BULK_EMAIL_DAILY_LIMIT) || 1000);
/** Ceiling a workspace can raise its own limit to; only the server's
 * operator can go higher, via the env var. */
export const MAX_DAILY_LIMIT = Math.max(DEFAULT_DAILY_LIMIT, Number(process.env.BULK_EMAIL_MAX_DAILY_LIMIT) || 10000);

export interface WorkspaceEmailSettings {
  postalAddress: string;
  dailyLimit: number;
  maxDailyLimit: number;
}

export async function getEmailSettings(workspaceId: string): Promise<WorkspaceEmailSettings> {
  const doc = await EmailSettings.findOne({ workspaceId }).lean();
  return {
    postalAddress: doc?.postalAddress ?? "",
    dailyLimit: Math.min(doc?.dailyLimit ?? DEFAULT_DAILY_LIMIT, MAX_DAILY_LIMIT),
    maxDailyLimit: MAX_DAILY_LIMIT,
  };
}

/** Recipients this workspace has queued in the last 24 hours. Recipients
 * a cancelled send never reached don't count. */
export async function recipientsQueuedLast24h(workspaceId: string): Promise<number> {
  const [row] = await BulkEmailJob.aggregate<{ total: number }>([
    { $match: { workspaceId, createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
    {
      $project: {
        counted: {
          $cond: [
            { $eq: ["$status", "cancelled"] },
            { $size: { $filter: { input: "$recipients", cond: { $ne: ["$$this.status", "pending"] } } } },
            { $size: "$recipients" },
          ],
        },
      },
    },
    { $group: { _id: null, total: { $sum: "$counted" } } },
  ]);
  return row?.total ?? 0;
}
