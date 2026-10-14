// app/api/email/attachments/[id]/route.ts
//
// Session-cookie protected. DELETE removes an uploaded attachment, unless
// a send already uses it (sends must keep their files).

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailAttachment } from "@/lib/models/EmailAttachment";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can remove attachments.", 403);
  }
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Attachment not found.", 404);

  // Still referenced by a send -> keep the file; the draft just drops it.
  if (await BulkEmailJob.exists({ workspaceId: auth.workspaceId, attachmentIds: id })) {
    return apiSuccess({ id, kept: true }, "Removed from this draft.");
  }
  await EmailAttachment.deleteOne({ _id: id, workspaceId: auth.workspaceId });
  return apiSuccess({ id }, "Attachment removed.");
}
