// app/api/email/drafts/[id]/route.ts
//
// Session-cookie protected. GET loads a draft into Compose; PUT saves
// changes to it; DELETE discards it (Compose also deletes it once the
// email has been sent).

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { workVisibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailDraft } from "@/lib/models/EmailDraft";
import { cleanDraftInput, type DraftInput } from "@/lib/bulk-email/drafts";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Draft not found.", 404);

  const draft = await EmailDraft.findOne({ _id: id, ...(await workVisibleTo(auth)) }).lean();
  if (!draft) return apiError("Draft not found.", 404);
  const { _id, __v, workspaceId: _w, ...rest } = draft as typeof draft & { __v?: number };
  return apiSuccess({ id: String(_id), ...rest });
}

async function authorizeWrite() {
  const auth = await requireAuth();
  if (!auth) return { error: apiError("Not authenticated.", 401) };
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return { error: apiError("Only managers, admins, and owners can change drafts.", 403) };
  }
  return { auth };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { auth, error } = await authorizeWrite();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Draft not found.", 404);

  const result = await cleanDraftInput(auth!, (await req.json()) as DraftInput);
  if ("error" in result) return apiError(result.error!, 400);
  // Fields left empty are cleared, so the saved draft matches Compose exactly.
  const set = Object.fromEntries(Object.entries(result.value).filter(([, v]) => v !== undefined));
  const unset = Object.fromEntries(Object.entries(result.value).filter(([, v]) => v === undefined).map(([k]) => [k, 1]));
  const updated = await EmailDraft.findOneAndUpdate(
    { _id: id, ...(await workVisibleTo(auth!)) },
    { $set: { ...set, updatedBy: auth!.userId }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true, projection: { updatedAt: 1 } }
  ).lean();
  if (!updated) return apiError("Draft not found.", 404);
  return apiSuccess({ id, updatedAt: updated.updatedAt }, "Draft saved.");
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { auth, error } = await authorizeWrite();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Draft not found.", 404);
  const deleted = await EmailDraft.deleteOne({ _id: id, ...(await workVisibleTo(auth!)) });
  if (deleted.deletedCount === 0) return apiError("Draft not found.", 404);
  return apiSuccess({ id }, "Draft deleted.");
}
