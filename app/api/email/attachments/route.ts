// app/api/email/attachments/route.ts
//
// Session-cookie protected. POST (multipart, field "file") uploads one
// attachment for a bulk email draft.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailAttachment } from "@/lib/models/EmailAttachment";
import { contentTypeFor, MAX_ATTACHMENTS_BYTES } from "@/lib/bulk-email/attachments";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can add attachments.", 403);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return apiError("Choose a file to attach.", 400);

  const filename = file.name.replace(/[\\/\r\n"]/g, "_").slice(0, 150) || "attachment";
  const contentType = contentTypeFor(filename);
  if (!contentType) {
    return apiError("That file type can't be attached. Use PDF, images, Word, Excel, PowerPoint, CSV, TXT or calendar (.ics) files.", 400);
  }
  if (file.size === 0) return apiError("That file is empty.", 400);
  if (file.size > MAX_ATTACHMENTS_BYTES) {
    return apiError(`That file is ${(file.size / 1048576).toFixed(1)} MB -- the limit is ${(MAX_ATTACHMENTS_BYTES / 1048576).toFixed(1)} MB per email.`, 400);
  }

  const doc = await EmailAttachment.create({
    workspaceId: auth.workspaceId,
    filename,
    contentType,
    size: file.size,
    data: Buffer.from(await file.arrayBuffer()),
    createdBy: auth.userId,
  });
  return apiSuccess({ id: String(doc._id), filename, size: file.size }, "Attached.", 201);
}
