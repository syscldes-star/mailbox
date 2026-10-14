// app/api/email/bulk/[id]/recipients/route.ts
//
// Session-cookie protected. POST {recipients: [...]} adds one batch of
// recipients (up to 5,000) to a send that is still "preparing".

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { addRecipients, cleanRecipients, type IncomingRecipient } from "@/lib/bulk-email/recipient-store";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

const MAX_BATCH = 5000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can send bulk email.", 403);
  }
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Bulk send not found.", 404);

  const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId }).select("status").lean();
  if (!job) return apiError("Bulk send not found.", 404);
  if (job.status !== "preparing") return apiError("Recipients can only be added before the send starts.", 409);

  const { recipients } = (await req.json()) as { recipients?: IncomingRecipient[] };
  if (!Array.isArray(recipients) || recipients.length === 0) return apiError("No recipients in this batch.", 400);
  if (recipients.length > MAX_BATCH) return apiError(`Upload at most ${MAX_BATCH} recipients per batch.`, 400);

  try {
    const result = await addRecipients(job._id, auth.workspaceId, cleanRecipients(recipients));
    return apiSuccess(result);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Couldn't add recipients.", 400);
  }
}
