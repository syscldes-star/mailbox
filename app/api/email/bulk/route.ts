// app/api/email/bulk/route.ts
//
// Session-cookie protected. GET lists this workspace's bulk sends (with
// per-status counts, not the full recipient list) plus the domains it can
// send from; POST creates a job and starts delivering it in the
// background.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { isValidEmail, MAX_RECIPIENTS_PER_JOB } from "@/lib/bulk-email/recipients";
import { resumeStaleJobs, startBulkJob } from "@/lib/bulk-email/process-job";
import { getEmailSettings, recipientsQueuedLast24h } from "@/lib/bulk-email/settings";
import { LOCAL_PART_PATTERN, MIN_SEND_ROLE, loadSenderDomains, publicBaseUrl } from "@/lib/bulk-email/access";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  await resumeStaleJobs(auth.workspaceId);

  const [senders, settings, usedLast24h, jobs] = await Promise.all([
    loadSenderDomains(auth.workspaceId),
    getEmailSettings(auth.workspaceId),
    recipientsQueuedLast24h(auth.workspaceId),
    BulkEmailJob.aggregate([
      { $match: { workspaceId: auth.workspaceId } },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      {
        $project: {
          fromDomain: 1,
          fromLocalPart: 1,
          fromName: 1,
          subject: 1,
          status: 1,
          error: 1,
          createdAt: 1,
          completedAt: 1,
          total: { $size: "$recipients" },
          sent: { $size: { $filter: { input: "$recipients", cond: { $eq: ["$$this.status", "sent"] } } } },
          failed: { $size: { $filter: { input: "$recipients", cond: { $eq: ["$$this.status", "failed"] } } } },
          skipped: { $size: { $filter: { input: "$recipients", cond: { $eq: ["$$this.status", "skipped"] } } } },
          opened: {
            $size: {
              $filter: { input: "$recipients", cond: { $ne: [{ $ifNull: ["$$this.openedAt", null] }, null] } },
            },
          },
          clicked: {
            $size: {
              $filter: { input: "$recipients", cond: { $ne: [{ $ifNull: ["$$this.clickedAt", null] }, null] } },
            },
          },
          bounced: {
            $size: {
              $filter: {
                input: "$recipients",
                cond: { $in: [{ $ifNull: ["$$this.deliveryIssue", null] }, ["bounced", "soft_bounced"]] },
              },
            },
          },
          complained: {
            $size: { $filter: { input: "$recipients", cond: { $eq: ["$$this.deliveryIssue", "complained"] } } },
          },
          trackOpens: 1,
          trackClicks: 1,
        },
      },
    ]),
  ]);

  return apiSuccess({
    senders,
    canSend: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
    settings,
    usage: { usedLast24h, dailyLimit: settings.dailyLimit },
    jobs: jobs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })),
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
  recipients?: { email?: string; name?: string; vars?: Record<string, unknown> }[];
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

  // Re-validate and de-duplicate server-side -- never trust the
  // browser's own parse of the recipient list.
  const seen = new Set<string>();
  const recipients = [];
  for (const r of body.recipients ?? []) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (!isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.vars ?? {})) {
      if (/^[a-z0-9_]{1,64}$/.test(k)) vars[k] = String(v ?? "").slice(0, 1000);
    }
    recipients.push({ email, name: r.name?.trim().slice(0, 200) || undefined, vars, status: "pending" as const });
  }

  if (recipients.length === 0) return apiError("Add at least one valid recipient.", 400);
  if (recipients.length > MAX_RECIPIENTS_PER_JOB) {
    return apiError(`A single send is limited to ${MAX_RECIPIENTS_PER_JOB} recipients.`, 400);
  }

  const settings = await getEmailSettings(auth.workspaceId);
  if (!settings.postalAddress) {
    return apiError(
      "Add your business postal address in Bulk Email → Settings first. Anti-spam laws require it in marketing email.",
      400
    );
  }
  const used = await recipientsQueuedLast24h(auth.workspaceId);
  if (used + recipients.length > settings.dailyLimit) {
    const left = Math.max(0, settings.dailyLimit - used);
    return apiError(
      `This would exceed your daily limit of ${settings.dailyLimit.toLocaleString()} recipients ` +
        `(${used.toLocaleString()} used in the last 24 hours, ${left.toLocaleString()} left).`,
      429
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
    bodyHtml,
    trackOpens: body.trackOpens !== false,
    trackClicks: body.trackClicks !== false,
    publicBaseUrl: publicBaseUrl(req),
    postalAddress: settings.postalAddress,
    recipients,
    status: "sending",
  });

  startBulkJob(String(job._id));

  return apiSuccess({ id: String(job._id), total: recipients.length }, "Bulk send started.", 201);
}
