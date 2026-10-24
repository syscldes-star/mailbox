// app/api/email/templates/route.ts
//
// Session-cookie protected. GET lists the workspace's saved templates;
// POST saves a new one.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { logWork } from "@/lib/activity";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailTemplate } from "@/lib/models/EmailTemplate";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

const MAX_BODY_LENGTH = 500_000;

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const templates = await EmailTemplate.find({ workspaceId: auth.workspaceId }).sort({ updatedAt: -1 }).lean();
  return apiSuccess({
    templates: templates.map(({ _id, __v, workspaceId: _w, ...rest }) => ({ id: String(_id), ...rest })),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can save templates.", 403);
  }

  const { name, subject, preheader, bodyHtml } = await req.json();
  const trimmedName = String(name ?? "").trim().slice(0, 120);
  if (!trimmedName) return apiError("Give the template a name.", 400);
  if (!bodyHtml || String(bodyHtml).length > MAX_BODY_LENGTH) return apiError("Template body is empty or too large.", 400);

  const template = await EmailTemplate.create({
    workspaceId: auth.workspaceId,
    name: trimmedName,
    subject: String(subject ?? "").slice(0, 500),
    preheader: preheader ? String(preheader).slice(0, 300) : undefined,
    bodyHtml: String(bodyHtml),
    createdBy: auth.userId,
  });
  await logWork(auth, "email_template_saved", trimmedName);

  return apiSuccess({ id: String(template._id) }, "Template saved.", 201);
}
