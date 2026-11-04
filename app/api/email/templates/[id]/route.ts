// app/api/email/templates/[id]/route.ts
//
// Session-cookie protected. PUT updates a saved template (name, subject,
// preview text, body); DELETE removes it.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { visibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailTemplate } from "@/lib/models/EmailTemplate";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

async function authorize() {
  const auth = await requireAuth();
  if (!auth) return { error: apiError("Not authenticated.", 401) };
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return { error: apiError("Only managers, admins, and owners can edit templates.", 403) };
  }
  return { auth };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { auth, error } = await authorize();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Template not found.", 404);

  const { name, subject, preheader, bodyHtml } = await req.json();
  const update: Record<string, unknown> = {};
  if (name !== undefined) {
    const trimmed = String(name).trim().slice(0, 120);
    if (!trimmed) return apiError("Template name can't be empty.", 400);
    update.name = trimmed;
  }
  if (subject !== undefined) update.subject = String(subject).slice(0, 500);
  if (preheader !== undefined) update.preheader = String(preheader).slice(0, 300);
  if (bodyHtml !== undefined) {
    if (!bodyHtml || String(bodyHtml).length > 500_000) return apiError("Template body is empty or too large.", 400);
    update.bodyHtml = String(bodyHtml);
  }

  const result = await EmailTemplate.updateOne({ _id: id, ...visibleTo(auth!) }, { $set: update });
  if (result.matchedCount === 0) return apiError("Template not found.", 404);
  return apiSuccess({ id }, "Template updated.");
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { auth, error } = await authorize();
  if (error) return error;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Template not found.", 404);

  const result = await EmailTemplate.deleteOne({ _id: id, ...visibleTo(auth!) });
  if (result.deletedCount === 0) return apiError("Template not found.", 404);
  return apiSuccess({ id }, "Template deleted.");
}
