// app/api/email/bulk/[id]/route.ts
//
// Session-cookie protected. GET returns one bulk send including every
// recipient's outcome, or with ?draft=all|not_opened|not_clicked the
// message and recipient list needed to send it again from Compose.
// PATCH {action}:
//   "start"        -- a "preparing" send whose recipients are uploaded
//                     begins sending (or waits for its scheduled time)
//   "cancel"       -- stops a send in progress, scheduled or preparing
//   "resume"       -- continues a cancelled/failed send's pending recipients
//   "retry_failed" -- also re-queues recipients that failed

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { BulkRecipient } from "@/lib/models/BulkRecipient";
import { resumeStaleJobs, startBulkJob } from "@/lib/bulk-email/process-job";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";
import { EmailAttachment } from "@/lib/models/EmailAttachment";

type Params = { params: Promise<{ id: string }> };

const DRAFT_AUDIENCES = ["all", "not_opened", "not_clicked"] as const;
type DraftAudience = (typeof DRAFT_AUDIENCES)[number];

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Bulk send not found.", 404);

  const draft = req.nextUrl.searchParams.get("draft") as DraftAudience | null;
  if (draft) {
    if (!DRAFT_AUDIENCES.includes(draft)) return apiError("draft must be all, not_opened or not_clicked.", 400);
    const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId }).lean();
    if (!job) return apiError("Bulk send not found.", 404);
    const filter =
      draft === "all"
        ? {}
        : draft === "not_opened"
          ? { status: "sent", openedAt: null }
          : { status: "sent", clickedAt: null };
    const recipients = await BulkRecipient.find({ jobId: job._id, ...filter }).sort({ index: 1 }).select("email name vars").lean();
    return apiSuccess({
      fromDomain: job.fromDomain,
      fromLocalPart: job.fromLocalPart,
      fromName: job.fromName ?? "",
      replyTo: job.replyTo ?? "",
      subject: job.subject,
      preheader: job.preheader ?? "",
      bodyHtml: job.bodyHtml,
      trackOpens: job.trackOpens ?? true,
      trackClicks: job.trackClicks ?? true,
      utm: job.utm,
      attachments: (
        await EmailAttachment.find({ _id: { $in: job.attachmentIds ?? [] }, workspaceId: auth.workspaceId }).select("filename size").lean()
      ).map((a) => ({ id: String(a._id), filename: a.filename, size: a.size })),
      recipients: recipients.map((r) => ({ email: r.email, name: r.name ?? "", vars: r.vars ?? {} })),
    });
  }

  await resumeStaleJobs(auth.workspaceId);

  const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId }).select("-publicBaseUrl -heartbeatAt").lean();
  if (!job) return apiError("Bulk send not found.", 404);
  const recipients = await BulkRecipient.find({ jobId: job._id })
    .sort({ index: 1 })
    .select("-_id -jobId -workspaceId -vars -index")
    .lean();

  const { _id, __v, counts, ...rest } = job as typeof job & { __v?: number };
  return apiSuccess({ id: String(_id), ...rest, ...counts, recipients });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can manage bulk email.", 403);
  }

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Bulk send not found.", 404);
  const { action } = await req.json();

  if (action === "start") {
    const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId }).select("status scheduledAt counts").lean();
    if (!job) return apiError("Bulk send not found.", 404);
    if (job.status !== "preparing") return apiError("That send has already been started.", 409);
    if (job.counts.total === 0) return apiError("Add at least one valid recipient.", 400);
    if (job.scheduledAt && job.scheduledAt.getTime() < Date.now() + 30_000) {
      return apiError("The scheduled time has already passed -- pick a new time.", 400);
    }
    const next = job.scheduledAt ? "scheduled" : "sending";
    const flipped = await BulkEmailJob.updateOne({ _id: id, status: "preparing" }, { $set: { status: next } });
    if (flipped.modifiedCount !== 1) return apiError("That send has already been started.", 409);
    if (next === "sending") startBulkJob(id);
    return apiSuccess(
      { id, status: next, total: job.counts.total, scheduledAt: job.scheduledAt },
      next === "scheduled" ? "Bulk send scheduled." : "Bulk send started."
    );
  }

  if (action === "cancel") {
    const result = await BulkEmailJob.updateOne(
      { _id: id, workspaceId: auth.workspaceId, status: { $in: ["sending", "scheduled", "preparing"] } },
      { $set: { status: "cancelled", completedAt: new Date() }, $unset: { heartbeatAt: 1 } }
    );
    if (result.matchedCount === 0) return apiError("That send isn't in progress or scheduled.", 409);
    return apiSuccess({ id, status: "cancelled" }, "Send cancelled.");
  }

  if (action === "retry_failed" || action === "resume") {
    const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId }).select("status").lean();
    if (!job) return apiError("Bulk send not found.", 404);
    if (job.status === "sending" || job.status === "scheduled" || job.status === "preparing") {
      return apiError("That send is already in progress or scheduled.", 409);
    }

    let requeued = 0;
    if (action === "retry_failed") {
      const result = await BulkRecipient.updateMany({ jobId: job._id, status: "failed" }, { $set: { status: "pending" }, $unset: { error: 1 } });
      requeued = result.modifiedCount;
    }
    const remaining = await BulkRecipient.countDocuments({ jobId: job._id, status: "pending" });
    if (remaining === 0) return apiError("Nothing left to send.", 409);

    const restarted = await BulkEmailJob.updateOne(
      { _id: id, status: job.status },
      {
        $set: { status: "sending" },
        $inc: { "counts.failed": -requeued },
        $unset: { error: 1, completedAt: 1, heartbeatAt: 1 },
      }
    );
    if (restarted.modifiedCount !== 1) return apiError("That send changed -- refresh and try again.", 409);
    startBulkJob(id);
    return apiSuccess({ id, status: "sending", requeued, remaining }, "Send restarted.");
  }

  return apiError('action must be "start", "cancel", "resume", or "retry_failed".', 400);
}
