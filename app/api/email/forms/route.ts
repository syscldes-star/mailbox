// app/api/email/forms/route.ts
//
// Session-cookie protected. GET lists the workspace's signup forms; POST
// creates one.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { SignupForm } from "@/lib/models/SignupForm";
import { ContactList } from "@/lib/models/ContactList";
import { validateFormInput, type FormInput } from "@/lib/bulk-email/forms";
import { MIN_SEND_ROLE, publicBaseUrl } from "@/lib/bulk-email/access";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const forms = await SignupForm.find({ workspaceId: auth.workspaceId }).sort({ createdAt: -1 }).lean();
  const listNames = new Map(
    (await ContactList.find({ workspaceId: auth.workspaceId }).select("name").lean()).map((l) => [String(l._id), l.name])
  );
  return apiSuccess({
    forms: forms.map(({ _id, __v, workspaceId: _w, ...rest }) => ({
      id: String(_id),
      ...rest,
      listName: listNames.get(rest.listId) ?? "(deleted list)",
    })),
    baseUrl: publicBaseUrl(req),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can create signup forms.", 403);
  }
  const result = await validateFormInput(auth.workspaceId, (await req.json()) as FormInput, false);
  if ("error" in result) return apiError(result.error!, 400);

  const form = await SignupForm.create({ ...result.value, workspaceId: auth.workspaceId, createdBy: auth.userId });
  return apiSuccess({ id: String(form._id) }, "Signup form created.", 201);
}
