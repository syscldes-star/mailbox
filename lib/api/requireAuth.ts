import { connectToDatabase } from "../db/mongodb";
import { User, type IUser } from "../models/User";
import { WorkspaceMember, type IWorkspaceMember } from "../models/WorkspaceMember";
import { Workspace, type IWorkspace } from "../models/Workspace";
import { getSessionPayload } from "../auth/session";
import { isPlatformTeam, touchSession, underMaintenance } from "../platform";

/** The main app's panel that gives access to this app. */
export const APP_PANEL = "email";

export interface AuthContext {
  user: IUser;
  membership: IWorkspaceMember;
  workspace: IWorkspace | null;
  workspaceId: string;
  userId: string;
}

export type SessionCheck =
  | { ok: true; auth: AuthContext }
  /** signed_out: no/invalid/old session (log in again on main).
   * no_access: signed in, but this app's panel isn't theirs (yet), or
   * their workspace is suspended, or the platform is in maintenance --
   * main sends them where they belong. */
  | { ok: false; reason: "signed_out" | "no_access" };

/** Same rules as main's lib/access.ts: the platform admin can use every
 * panel; otherwise the workspace must be active, and the owner gets the
 * workspace's panels while a team member gets the ones their owner gave
 * them (that the workspace still has). */
function hasAppPanel(user: IUser, membership: IWorkspaceMember, workspace: IWorkspace | null): boolean {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail && user.email.toLowerCase() === adminEmail) return true;
  if (!workspace || (workspace.status ?? "active") !== "active") return false;
  const workspacePanels = workspace.panels ?? [];
  if (!workspacePanels.includes(APP_PANEL)) return false;
  return membership.role === "owner" || (membership.panels ?? []).includes(APP_PANEL);
}

/** Resolves the session cookie (set by main at login) and checks this
 * person may use this app. */
export async function checkSession(): Promise<SessionCheck> {
  const payload = await getSessionPayload();
  if (!payload) return { ok: false, reason: "signed_out" };

  await connectToDatabase();

  const [user, membership, workspace] = await Promise.all([
    User.findById(payload.userId),
    WorkspaceMember.findOne({ workspaceId: payload.workspaceId, userId: payload.userId }),
    Workspace.findById(payload.workspaceId),
  ]);

  if (!user || !membership) return { ok: false, reason: "signed_out" };
  // Signed out everywhere on main (e.g. a password change) since this
  // token was issued.
  if ((payload.sv ?? 0) !== (user.sessionVersion ?? 0)) return { ok: false, reason: "signed_out" };
  // Blocked by the platform admin (main also ended their sessions).
  if (user.blocked && !isPlatformTeam(user)) return { ok: false, reason: "signed_out" };
  if (!hasAppPanel(user, membership, workspace)) return { ok: false, reason: "no_access" };
  // Maintenance mode (main's Settings): main shows the "Back soon" screen.
  if (!isPlatformTeam(user) && (await underMaintenance())) return { ok: false, reason: "no_access" };

  touchSession(payload.sid);

  return {
    ok: true,
    auth: { user, membership, workspace, workspaceId: payload.workspaceId, userId: payload.userId },
  };
}

/** For API routes: the signed-in person, or null for anyone who can't
 * use this app right now (routes answer 401). */
export async function requireAuth(): Promise<AuthContext | null> {
  const result = await checkSession();
  return result.ok ? result.auth : null;
}

const ROLE_RANK: Record<string, number> = {
  readonly: 0,
  staff: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export function hasMinimumRole(role: string, minimum: string): boolean {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[minimum] ?? Infinity);
}
