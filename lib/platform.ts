import mongoose, { Schema } from "mongoose";

// Read-only views of collections main owns on the platform database:
// its settings (maintenance mode), the admin's announcements, and the
// device list (usersessions). Main defines them -- keep in step with its
// lib/models/PlatformSettings.ts, Announcement.ts and UserSession.ts.

const readOnly = { autoIndex: false, strict: false } as const;

const PlatformSettings =
  mongoose.models.PlatformSettings ??
  mongoose.model("PlatformSettings", new Schema({ key: String, maintenance: Boolean }, { ...readOnly, collection: "platformsettings" }));

const Announcement =
  mongoose.models.Announcement ??
  mongoose.model(
    "Announcement",
    new Schema(
      {
        title: String,
        message: String,
        tone: String,
        panels: [String],
        ownersOnly: Boolean,
        onlyInPanels: Boolean,
        banner: Boolean,
        active: Boolean,
        showUntil: Date,
        createdAt: Date,
      },
      { ...readOnly, collection: "announcements" }
    )
  );

const UserSession =
  mongoose.models.UserSession ??
  mongoose.model("UserSession", new Schema({ sid: String, lastSeenAt: Date }, { ...readOnly, collection: "usersessions" }));

/** The platform team: the platform admin (PLATFORM_ADMIN_EMAIL, same as
 * main) and support staff. */
export function isPlatformTeam(user: { email: string; platformRole?: string | null }): boolean {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  return (!!adminEmail && user.email.toLowerCase() === adminEmail) || user.platformRole === "support";
}

/** The title shown under the person's name in the header: "Super Admin"
 * for the platform admin, "Support" for support staff, otherwise null
 * (the header shows their workspace role). Same as main. */
export function platformTitle(user: { email: string; platformRole?: string | null }): "Super Admin" | "Support" | null {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail && user.email.toLowerCase() === adminEmail) return "Super Admin";
  return user.platformRole === "support" ? "Support" : null;
}

// Checked on every request, so remembered for a few seconds.
let maintenanceCache: { value: boolean; at: number } | null = null;

/** Whether the platform admin has switched on maintenance mode (main's
 * Settings). Everyone but the platform team is sent to main, which
 * shows the "Back soon" screen. */
export async function underMaintenance(): Promise<boolean> {
  if (maintenanceCache && Date.now() - maintenanceCache.at < 15_000) return maintenanceCache.value;
  try {
    const doc = await PlatformSettings.findOne({ key: "platform" }, { maintenance: 1 }).lean<{ maintenance?: boolean }>();
    maintenanceCache = { value: !!doc?.maintenance, at: Date.now() };
  } catch {
    // Can't tell: don't lock everyone out over it.
    return maintenanceCache?.value ?? false;
  }
  return maintenanceCache.value;
}

/** "Last seen" for main's device list, at most every 5 minutes per
 * device. Never waits or throws. */
export function touchSession(sid: string | undefined): void {
  if (!sid) return;
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  UserSession.updateOne({ sid, lastSeenAt: { $lt: staleBefore } }, { lastSeenAt: new Date() }).catch(() => undefined);
}

export interface AnnouncementBanner {
  id: string;
  title: string;
  message: string;
  tone: "info" | "warning";
}

/** The admin's banners for this person in this app -- the same rules as
 * main: active workspaces only; `panels` matches people who have one of
 * them themselves (the owner: all the workspace's panels; a team member:
 * the ones they were given); `ownersOnly` skips team members;
 * `onlyInPanels` shows it only in those panels' apps (so here only if
 * `appPanel` is one of them); the platform team gets none. */
export async function bannersFor(
  auth: {
    user: { email: string; platformRole?: string | null };
    membership: { role: string; panels?: string[] };
    workspace: { status?: string; panels?: string[] } | null;
  },
  appPanel: string
): Promise<AnnouncementBanner[]> {
  if (isPlatformTeam(auth.user) || (auth.workspace?.status ?? "active") !== "active") return [];
  const workspacePanels = auth.workspace?.panels ?? [];
  const mine =
    auth.membership.role === "owner" ? workspacePanels : (auth.membership.panels ?? []).filter((p) => workspacePanels.includes(p));
  const now = new Date();
  const list = await Announcement.find({
    active: true,
    banner: true,
    $or: [{ showUntil: { $exists: false } }, { showUntil: null }, { showUntil: { $gt: now } }],
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean<
      { _id: unknown; title: string; message: string; tone?: string; panels?: string[]; ownersOnly?: boolean; onlyInPanels?: boolean }[]
    >();
  return list
    .filter((a) => !(a.ownersOnly && auth.membership.role !== "owner"))
    .filter((a) => !a.panels?.length || a.panels.some((p) => mine.includes(p)))
    .filter((a) => !a.onlyInPanels || !!a.panels?.includes(appPanel))
    .slice(0, 3)
    .map((a) => ({ id: String(a._id), title: a.title, message: a.message, tone: a.tone === "warning" ? "warning" : "info" }));
}
