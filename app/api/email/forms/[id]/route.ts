// app/api/email/forms/[id]/route.ts
//
// Session-cookie protected. PUT updates a signup form (including turning
// it on/off); DELETE removes it. Subscribers it already added stay on
// their list.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { visibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { SignupForm } from "@/lib/models/SignupForm";
import { validateFormInput, type FormInput } from "@/lib/bulk-email/forms";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

async function authorize() {
  const auth = await requireAuth();
  if (!auth) return { error: apiError("Not authenticated.", 401) };
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return { error: apiError("Only managers, admins, and owners can edit signup forms.", 403) };
  }
  return { auth };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { auth, error } = await authorize();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Form not found.", 404);

  const result = await validateFormInput(auth!.workspaceId, (await req.json()) as FormInput, true, visibleTo(auth!));
  if ("error" in result) return apiError(result.error!, 400);
  const updated = await SignupForm.updateOne({ _id: id, ...visibleTo(auth!) }, { $set: result.value });
  if (updated.matchedCount === 0) return apiError("Form not found.", 404);
  return apiSuccess({ id }, "Signup form saved.");
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { auth, error } = await authorize();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Form not found.", 404);
  const deleted = await SignupForm.deleteOne({ _id: id, ...visibleTo(auth!) });
  if (deleted.deletedCount === 0) return apiError("Form not found.", 404);
  return apiSuccess({ id }, "Signup form deleted.");
}
