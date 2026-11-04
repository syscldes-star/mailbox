import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { isOwner, shareableMembers, userNames } from "@/lib/visibility";
import { Campaign } from "@/lib/models/Campaign";
import { EmailTemplate } from "@/lib/models/EmailTemplate";
import { ContactList } from "@/lib/models/ContactList";
import { SignupForm } from "@/lib/models/SignupForm";
import { logWork } from "@/lib/activity";

type Params = { params: Promise<{ kind: string; id: string }> };

// Everything that can be shared, and what it's called in messages. Sends
// and drafts follow their campaign, so sharing a campaign shares those.
const KINDS = {
  campaigns: { label: "campaign", model: Campaign },
  templates: { label: "template", model: EmailTemplate },
  lists: { label: "list", model: ContactList },
  forms: { label: "signup form", model: SignupForm },
} as const;

/** Sets sharedWith and returns the item's name, or null if it's gone. */
async function setSharing(kind: keyof typeof KINDS, filter: object, userIds: string[]): Promise<{ name: string } | null> {
  // Each model's own updateOne/findOne -- typed per model rather than via
  // a union, which TypeScript can't call.
  const model = KINDS[kind].model as unknown as {
    updateOne: (f: object, u: object) => Promise<{ matchedCount: number }>;
    findOne: (f: object) => { select: (s: string) => { lean: () => Promise<{ name?: string } | null> } };
  };
  const { matchedCount } = await model.updateOne(filter, { $set: { sharedWith: userIds } });
  if (matchedCount === 0) return null;
  const doc = await model.findOne(filter).select("name").lean();
  return doc ? { name: doc.name ?? "" } : null;
}

/** PUT {userIds}: owner only. Sets which team members can see and use it
 * ([] = private to its creator and the owner again). */
export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!isOwner(auth)) return apiError("Only the workspace owner can share.", 403);

  const { kind, id } = await params;
  const target = KINDS[kind as keyof typeof KINDS];
  if (!target || !mongoose.isValidObjectId(id)) return apiError("Not found.", 404);

  const body = await req.json().catch(() => null);
  const raw: unknown = body?.userIds;
  if (!Array.isArray(raw) || raw.length > 200 || raw.some((x) => typeof x !== "string")) {
    return apiError("userIds must be a list of team member ids.", 400);
  }
  const userIds = [...new Set(raw as string[])];

  const allowed = new Set((await shareableMembers(auth.workspaceId)).map((m) => m.userId));
  if (userIds.some((uid) => !allowed.has(uid))) {
    return apiError("You can only share with team members who have the Email panel.", 400);
  }

  const doc = await setSharing(kind as keyof typeof KINDS, { _id: id, workspaceId: auth.workspaceId }, userIds);
  if (!doc) return apiError(`That ${target.label} no longer exists.`, 404);

  const names = await userNames(userIds);
  const who = userIds.map((u) => names.get(u)).join(", ");
  await logWork(auth, "email_shared", `${target.label} ${doc.name} · ${userIds.length ? `shared with ${who}` : "no longer shared"}`);
  return apiSuccess(
    { sharedWith: userIds },
    userIds.length
      ? `Shared with ${who}.`
      : `This ${target.label} is private again.`
  );
}
