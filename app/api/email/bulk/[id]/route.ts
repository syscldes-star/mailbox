// app/api/email/bulk/[id]/route.ts
//
// Session-cookie protected. GET returns one bulk send including every
// recipient's outcome, or with ?draft=all|not_opened|not_clicked the
// message and recipient list needed to send it again from Compose.
// PATCH {action: "cancel"} stops a send in progress (or a scheduled one)
// and {action: "retry_failed"} re-queues recipients that failed;
// {action: "ab_decide", variant?} picks an A/B test's winner now.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { decideAbTest, resumeStaleJobs, startBulkJob, variantStats } from "@/lib/bulk-email/process-job";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

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
    const recipients = job.recipients.filter((r) =>
      draft === "all" ? true : draft === "not_opened" ? r.status === "sent" && !r.openedAt : r.status === "sent" && !r.clickedAt
    );
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
      recipients: recipients.map((r) => ({ email: r.email, name: r.name ?? "", vars: r.vars ?? {} })),
    });
  }

  await resumeStaleJobs(auth.workspaceId);

  const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId })
    .select("-publicBaseUrl -heartbeatAt -recipients.vars")
    .lean();
  if (!job) return apiError("Bulk send not found.", 404);

  const { _id, __v, ...rest } = job as typeof job & { __v?: number };
  const ab = job.abTest
    ? { ...job.abTest, statsA: variantStats(job.recipients, "A"), statsB: variantStats(job.recipients, "B") }
    : undefined;
  return apiSuccess({ id: String(_id), ...rest, abTest: ab });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can manage bulk email.", 403);
  }

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Bulk send not found.", 404);
  const { action, variant } = await req.json();

  if (action === "cancel") {
    const result = await BulkEmailJob.updateOne(
      { _id: id, workspaceId: auth.workspaceId, status: { $in: ["sending", "scheduled", "testing"] } },
      { $set: { status: "cancelled", completedAt: new Date() }, $unset: { heartbeatAt: 1 } }
    );
    if (result.matchedCount === 0) return apiError("That send isn't in progress or scheduled.", 409);
    return apiSuccess({ id, status: "cancelled" }, "Send cancelled.");
  }

  if (action === "retry_failed" || action === "resume") {
    // "resume" continues a cancelled/failed job's still-pending
    // recipients; "retry_failed" additionally re-queues failed ones.
    const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId });
    if (!job) return apiError("Bulk send not found.", 404);
    if (job.status === "sending" || job.status === "scheduled" || job.status === "testing") {
      return apiError("That send is already in progress or scheduled.", 409);
    }

    let requeued = 0;
    for (const r of job.recipients) {
      if (action === "retry_failed" && r.status === "failed") {
        r.status = "pending";
        r.error = undefined;
        requeued++;
      }
    }
    const remaining = job.recipients.filter((r) => r.status === "pending").length;
    if (remaining === 0) return apiError("Nothing left to send.", 409);

    job.status = "sending";
    job.error = undefined;
    job.completedAt = undefined;
    job.heartbeatAt = undefined;
    await job.save();
    startBulkJob(id);
    return apiSuccess({ id, status: "sending", requeued, remaining }, "Send restarted.");
  }

  if (action === "ab_decide") {
    const job = await BulkEmailJob.findOne({ _id: id, workspaceId: auth.workspaceId }).select("status abTest").lean();
    if (!job?.abTest) return apiError("That send isn't an A/B test.", 400);
    if (job.abTest.winner) return apiError("A winner has already been picked.", 409);
    if (job.status !== "testing") return apiError("Wait until the test group has finished sending.", 409);
    const winner = await decideAbTest(id, variant === "A" || variant === "B" ? variant : undefined, "manual");
    if (!winner) return apiError("Couldn't pick a winner -- refresh and try again.", 409);
    return apiSuccess({ id, winner }, `Subject ${winner} wins -- sending it to everyone else now.`);
  }

  return apiError('action must be "cancel", "resume", "retry_failed" or "ab_decide".', 400);
}
