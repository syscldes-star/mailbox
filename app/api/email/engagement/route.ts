// app/api/email/engagement/route.ts
//
// Session-cookie protected. GET scores everyone emailed recently
// (?days=90&minSends=3, optional &segment= and &q=). POST
// {action:"stop_inactive", days, minSends} adds every inactive person to
// the do-not-email list (reason "inactive") so future sends skip them;
// they can be removed again from Subscribers → Unsubscribed.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailSuppression } from "@/lib/models/EmailSuppression";
import { cleanOptions, computeEngagement, SEGMENTS, type Segment } from "@/lib/bulk-email/engagement";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

const LIMIT = 1000;

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const q = req.nextUrl.searchParams;
  const options = cleanOptions({ days: q.get("days"), minSends: q.get("minSends") });
  const segment = q.get("segment") as Segment | null;
  const search = (q.get("q") ?? "").trim().toLowerCase();

  const { people, summary, alreadyStopped, trackedSends } = await computeEngagement(auth.workspaceId, options);
  const matching = people
    .filter((p) => (!segment || !SEGMENTS.includes(segment) || p.segment === segment))
    .filter((p) => !search || p.email.includes(search) || (p.name ?? "").toLowerCase().includes(search))
    // Least engaged first: that's who needs attention.
    .sort((a, b) => a.score - b.score || b.received - a.received);

  return apiSuccess({
    ...options,
    summary,
    total: people.length,
    alreadyStopped,
    trackedSends,
    matching: matching.length,
    people: matching.slice(0, LIMIT),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can change who is emailed.", 403);
  }
  const body = (await req.json()) as { action?: string; days?: number; minSends?: number };
  if (body.action !== "stop_inactive") return apiError("Unknown action.", 400);

  const options = cleanOptions(body);
  const { people } = await computeEngagement(auth.workspaceId, options);
  const inactive = people.filter((p) => p.segment === "inactive");
  if (inactive.length === 0) return apiSuccess({ stopped: 0 }, "Nobody is inactive right now.");

  const note = `No opens or clicks in ${options.days} days`;
  for (let i = 0; i < inactive.length; i += 1000) {
    await EmailSuppression.bulkWrite(
      inactive.slice(i, i + 1000).map((p) => ({
        updateOne: {
          filter: { workspaceId: auth.workspaceId, email: p.email },
          update: { $setOnInsert: { workspaceId: auth.workspaceId, email: p.email, reason: "inactive", note: `${note} (${p.received} emails)` } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  return apiSuccess({ stopped: inactive.length }, `Stopped emailing ${inactive.length} inactive ${inactive.length === 1 ? "person" : "people"}.`);
}
