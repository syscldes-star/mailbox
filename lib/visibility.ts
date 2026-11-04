import type { AuthContext } from "@/lib/api/requireAuth";
import { APP_PANEL } from "@/lib/api/requireAuth";
import { User } from "@/lib/models/User";
import { WorkspaceMember } from "@/lib/models/WorkspaceMember";
import { Workspace } from "@/lib/models/Workspace";
import { Campaign } from "@/lib/models/Campaign";

// The platform rule for work: the workspace owner sees everything in the
// workspace; a team member sees what they created plus what the owner
// shared with them.
//
// - Shared directly: campaigns, templates, lists (with their contacts)
//   and signup forms -- these carry `sharedWith`.
// - Sends and drafts follow their campaign: visible if you made them, or
//   if they belong to a campaign you can see.
// - Workspace setup stays visible to everyone with the Email panel:
//   domains, mailboxes, settings, suppressions, images and attachments.

export const isOwner = (auth: AuthContext) => auth.membership.role === "owner";

/** Filter for campaigns, templates, lists and signup forms. */
export function visibleTo(auth: AuthContext): Record<string, unknown> {
  if (isOwner(auth)) return { workspaceId: auth.workspaceId };
  return { workspaceId: auth.workspaceId, $or: [{ createdBy: auth.userId }, { sharedWith: auth.userId }] };
}

/** Ids of the campaigns this person can see, or null for "all" (owner). */
export async function visibleCampaignIds(auth: AuthContext): Promise<string[] | null> {
  if (isOwner(auth)) return null;
  const rows = await Campaign.find(visibleTo(auth)).select("_id").lean();
  return rows.map((r) => String(r._id));
}

/** Filter for sends (BulkEmailJob) and drafts: their own, or in a
 * campaign they can see. */
export async function workVisibleTo(auth: AuthContext): Promise<Record<string, unknown>> {
  const campaignIds = await visibleCampaignIds(auth);
  if (campaignIds === null) return { workspaceId: auth.workspaceId };
  return { workspaceId: auth.workspaceId, $or: [{ createdBy: auth.userId }, { campaignId: { $in: campaignIds } }] };
}

/** "First Last" for each user id. */
export async function userNames(ids: (string | undefined | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select("firstName lastName").lean();
  return new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
}

export interface Creator {
  id: string | null;
  name: string;
  isYou: boolean;
}

export function creatorOf(createdBy: string | undefined | null, names: Map<string, string>, auth: AuthContext): Creator {
  return {
    id: createdBy ?? null,
    name: createdBy ? (names.get(createdBy) ?? "Former team member") : "Workspace owner",
    isYou: createdBy === auth.userId,
  };
}

/** Adds `createdByInfo` (who made it) to each row, for the UI. */
export async function withCreators<T extends { createdBy?: string | null }>(
  rows: T[],
  auth: AuthContext
): Promise<(T & { createdByInfo: Creator })[]> {
  const names = await userNames(rows.map((r) => r.createdBy));
  return rows.map((r) => ({ ...r, createdByInfo: creatorOf(r.createdBy, names, auth) }));
}

export interface ShareableMember {
  userId: string;
  name: string;
  email: string;
}

/** Team members something can be shared with: everyone but the owner who
 * has the Email panel. */
export async function shareableMembers(workspaceId: string): Promise<ShareableMember[]> {
  const workspace = await Workspace.findById(workspaceId).select("panels").lean();
  if (!(workspace?.panels ?? []).includes(APP_PANEL)) return [];
  const members = await WorkspaceMember.find({ workspaceId, role: { $ne: "owner" }, panels: APP_PANEL }).select("userId").lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select("firstName lastName email").lean();
  return users.map((u) => ({ userId: String(u._id), name: `${u.firstName} ${u.lastName}`.trim(), email: u.email }));
}
