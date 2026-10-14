// app/api/email/bulk/route.ts
//
// Session-cookie protected. GET lists this workspace's bulk sends (with
// their running totals) plus the domains it can send from. POST creates a
// send in "preparing" state; Compose then uploads recipients in batches
// (POST /api/email/bulk/[id]/recipients) and starts it with
// PATCH {action: "start"} -- batching keeps each request small enough for
// any reverse proxy's body-size limit, even for very large lists.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { isValidEmail } from "@/lib/bulk-email/recipients";
import { resumeStaleJobs } from "@/lib/bulk-email/process-job";
import { getEmailSettings } from "@/lib/bulk-email/settings";
import { LOCAL_PART_PATTERN, MIN_SEND_ROLE, loadSenderDomains, publicBaseUrl } from "@/lib/bulk-email/access";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  await resumeStaleJobs(auth.workspaceId);

  const [senders, settings, jobs] = await Promise.all([
    loadSenderDomains(auth.workspaceId),
    getEmailSettings(auth.workspaceId),
    BulkEmailJob.find({ workspaceId: auth.workspaceId, status: { $ne: "preparing" } })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("fromDomain fromLocalPart fromName subject status error createdAt completedAt scheduledAt counts trackOpens trackClicks createdBy")
      .lean(),
  ]);

  return apiSuccess({
    senders,
    canSend: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
    settings,
    jobs: jobs.map(({ _id, counts, ...rest }) => ({ id: String(_id), ...rest, ...counts })),
  });
}

interface CreateBody {
  fromDomain?: string;
  fromLocalPart?: string;
  fromName?: string;
  replyTo?: string;
  subject?: string;
  bodyHtml?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
  preheader?: string;
  scheduledAt?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can send bulk email.", 403);
  }

  const body = (await req.json()) as CreateBody;
  const fromDomain = body.fromDomain?.trim().toLowerCase();
  const fromLocalPart = body.fromLocalPart?.trim().toLowerCase();
  const subject = body.subject?.trim();
  const bodyHtml = body.bodyHtml?.trim();
  const replyTo = body.replyTo?.trim() || undefined;
  const preheader = body.preheader?.trim().slice(0, 300) || undefined;

  let scheduledAt: Date | undefined;
  if (body.scheduledAt) {
    scheduledAt = new Date(body.scheduledAt);
    const now = Date.now();
    if (Number.isNaN(scheduledAt.getTime())) return apiError("Scheduled time isn't a valid date.", 400);
    if (scheduledAt.getTime() < now + 60_000) return apiError("Pick a scheduled time at least a minute from now.", 400);
    if (scheduledAt.getTime() > now + 90 * 24 * 60 * 60 * 1000) {
      return apiError("Sends can be scheduled up to 90 days ahead.", 400);
    }
  }

  if (!fromDomain || !fromLocalPart || !subject || !bodyHtml) {
    return apiError("fromDomain, fromLocalPart, subject, and bodyHtml are required.", 400);
  }
  if (!LOCAL_PART_PATTERN.test(fromLocalPart)) {
    return apiError("From address contains invalid characters.", 400);
  }
  if (replyTo && !isValidEmail(replyTo)) {
    return apiError("Reply-to must be a valid email address.", 400);
  }

  const senders = await loadSenderDomains(auth.workspaceId);
  if (!senders.some((s) => s.domain === fromDomain)) {
    return apiError("That domain isn't ready to send from yet (it needs an active approved sender).", 403);
  }

  const settings = await getEmailSettings(auth.workspaceId);
  if (!settings.postalAddress) {
    return apiError(
      "Add your business postal address in Email Marketing → Settings first. Anti-spam laws require it in marketing email.",
      400
    );
  }
  const job = await BulkEmailJob.create({
    workspaceId: auth.workspaceId,
    createdBy: auth.userId,
    fromDomain,
    fromLocalPart,
    fromName: body.fromName?.trim() || undefined,
    replyTo,
    subject,
    preheader,
    bodyHtml,
    trackOpens: body.trackOpens !== false,
    trackClicks: body.trackClicks !== false,
    publicBaseUrl: publicBaseUrl(req),
    postalAddress: settings.postalAddress,
    status: "preparing",
    scheduledAt,
  });

  return apiSuccess({ id: String(job._id) }, "Send created -- upload recipients, then start it.", 201);
}
