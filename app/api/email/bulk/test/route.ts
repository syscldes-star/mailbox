// app/api/email/bulk/test/route.ts
//
// Session-cookie protected. Sends a single test copy of a draft to one
// address, rendered with a sample recipient's merge tags, so the sender
// can check it in a real inbox before sending to the whole list.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { isValidEmail } from "@/lib/bulk-email/recipients";
import { buildMessage } from "@/lib/bulk-email/process-job";
import { sendEmail } from "@/lib/bulk-email/sender";
import { getEmailSettings } from "@/lib/bulk-email/settings";
import { loadAttachmentData, resolveAttachments } from "@/lib/bulk-email/attachments";
import { LOCAL_PART_PATTERN, MIN_SEND_ROLE, publicBaseUrl, senderProblem } from "@/lib/bulk-email/access";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can send bulk email.", 403);
  }

  const { testEmail, fromDomain, fromLocalPart, fromName, replyTo, subject, preheader, bodyHtml, sample, utm, attachmentIds } = await req.json();
  const to = String(testEmail ?? "").trim().toLowerCase();
  const domain = String(fromDomain ?? "").trim().toLowerCase();
  const localPart = String(fromLocalPart ?? "").trim().toLowerCase();

  if (!isValidEmail(to)) return apiError("Enter a valid test address.", 400);
  if (!domain || !localPart || !subject || !bodyHtml) {
    return apiError("From address, subject, and body are required.", 400);
  }
  if (!LOCAL_PART_PATTERN.test(localPart)) return apiError("From address contains invalid characters.", 400);
  if (replyTo && !isValidEmail(replyTo)) return apiError("Reply-to must be a valid email address.", 400);

  const problem = await senderProblem(auth.workspaceId, domain, localPart);
  if (problem) return apiError(problem, 403);

  const attached = await resolveAttachments(auth.workspaceId, attachmentIds);
  if ("error" in attached) return apiError(attached.error!, 400);

  const sampleVars: Record<string, string> = {};
  for (const [k, v] of Object.entries((sample?.vars ?? {}) as Record<string, unknown>)) sampleVars[k] = String(v ?? "");

  const message = buildMessage(
    {
      workspaceId: auth.workspaceId,
      fromDomain: domain,
      fromLocalPart: localPart,
      fromName: fromName || undefined,
      replyTo: replyTo || undefined,
      subject: `[Test] ${subject}`,
      preheader: preheader ? String(preheader).slice(0, 300) : undefined,
      bodyHtml,
      publicBaseUrl: publicBaseUrl(req),
      postalAddress: (await getEmailSettings(auth.workspaceId)).postalAddress,
      utm:
        utm && (utm.source || utm.medium || utm.campaign)
          ? { source: String(utm.source ?? "").slice(0, 100), medium: String(utm.medium ?? "").slice(0, 100), campaign: String(utm.campaign ?? "").slice(0, 100) }
          : undefined,
    },
    // Rendered with the sample recipient's data, but delivered to the
    // test address -- and the unsubscribe link targets the test address
    // too, so clicking it can't unsubscribe the real sample recipient.
    { email: to, name: sample?.name ?? "", vars: { ...sampleVars, email: sample?.email ?? to } }
  );

  try {
    // Address the test to just the test inbox -- the sample's name fills
    // {{name}} in the body, but showing "To: Alex <you@...>" is confusing.
    const result = await sendEmail({ ...message, to: { email: to }, attachments: await loadAttachmentData(attached.attachments!.map((a) => a.id)) });
    if (result.suppressed) {
      return apiError(`${to} is on Oracle's suppression list (a prior bounce or complaint), so it wasn't delivered.`, 409);
    }
    return apiSuccess({ messageId: result.messageId }, `Test sent to ${to}.`);
  } catch (err) {
    return apiError(`Test send failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
