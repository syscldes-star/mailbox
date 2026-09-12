// FILE: lib/api/requireAuth.ts
// (fixed import path -- see explanation in chat)

import { connectToDatabase } from "../db/mongodb";
import { User, type IUser } from "../models/User";
import { WorkspaceMember, type IWorkspaceMember } from "../models/WorkspaceMember";
import { getSessionPayload } from "../auth/session";

export interface AuthContext {
  user: IUser;
  membership: IWorkspaceMember;
  workspaceId: string;
  userId: string;
}

/**
 * Resolves the current request's session into a real user + workspace
 * membership. Returns null for any reason the request shouldn't proceed
 * as authenticated -- no session cookie, an expired/invalid token, or a
 * token that's technically valid but whose user or membership no longer
 * exists (e.g. the user was deleted, or removed from that workspace,
 * after the token was issued). Route handlers should treat null as "401
 * Unauthorized" uniformly rather than needing to distinguish these cases.
 */
export async function requireAuth(): Promise<AuthContext | null> {
  const payload = await getSessionPayload();
  if (!payload) return null;

  await connectToDatabase();

  const [user, membership] = await Promise.all([
    User.findById(payload.userId),
    WorkspaceMember.findOne({ workspaceId: payload.workspaceId, userId: payload.userId }),
  ]);

  if (!user || !membership) return null;

  return {
    user,
    membership,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
  };
}

const ROLE_RANK: Record<string, number> = {
  readonly: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

/** True if the member's role meets or exceeds the given minimum -- e.g.
 * hasMinimumRole(ctx.membership.role, "manager") also passes for "admin"
 * and "owner", matching how the PRD's permission tables are additive
 * ("Owner | Full Access", "Admin | Full Access", ...). */
export function hasMinimumRole(role: string, minimum: string): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? Infinity);
}