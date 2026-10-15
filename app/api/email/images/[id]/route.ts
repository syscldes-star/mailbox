// app/api/email/images/[id]/route.ts
//
// Session-cookie protected. DELETE removes an image from the library.
// Emails already sent with it will show a broken image from then on.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailImage } from "@/lib/models/EmailImage";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can delete images.", 403);
  }
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Image not found.", 404);
  const deleted = await EmailImage.deleteOne({ _id: id, workspaceId: auth.workspaceId });
  if (deleted.deletedCount === 0) return apiError("Image not found.", 404);
  return apiSuccess({ id }, "Image deleted.");
}
