// app/api/email/files/route.ts
//
// Session-cookie protected. POST {filename, size} starts hosting a file
// for download from an email; the browser then uploads it in pieces
// (PUT /api/email/files/<id>?n=0,1,...) and finishes with
// POST /api/email/files/<id> {action:"complete"}, which returns its URL.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailFile, FILE_CHUNK_BYTES, MAX_HOSTED_FILE_BYTES } from "@/lib/models/EmailFile";
import { contentTypeFor } from "@/lib/bulk-email/attachments";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) return apiError("Only managers, admins, and owners can add files.", 403);

  const body = (await req.json().catch(() => ({}))) as { filename?: string; size?: number };
  const filename = String(body.filename ?? "").replace(/[\\/\r\n"<>]/g, "_").slice(0, 150);
  const size = Math.floor(Number(body.size) || 0);
  const contentType = contentTypeFor(filename);
  if (!filename || !contentType) {
    return apiError("That file type can't be shared. Use PDF, images, Word, Excel, PowerPoint, CSV, TXT or calendar (.ics) files.", 400);
  }
  if (size <= 0) return apiError("That file is empty.", 400);
  if (size > MAX_HOSTED_FILE_BYTES) {
    return apiError(`That file is ${(size / 1048576).toFixed(1)} MB -- files up to ${MAX_HOSTED_FILE_BYTES / 1048576} MB can be hosted.`, 400);
  }
  const file = await EmailFile.create({
    workspaceId: auth.workspaceId,
    filename,
    contentType,
    size,
    chunks: Math.ceil(size / FILE_CHUNK_BYTES),
    createdBy: auth.userId,
  });
  return apiSuccess({ id: String(file._id), chunkSize: FILE_CHUNK_BYTES, chunks: file.chunks }, "Upload started.", 201);
}
