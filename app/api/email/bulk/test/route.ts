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
import { LOCAL_PART_PATTERN, MIN_SEND_ROLE, loadSenderDomains, publicBaseUrl } from "@/lib/bulk-email/access";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can send bulk email.", 403);
  }

  const { testEmail, fromDomain, fromLocalPart, fromName, replyTo, subject, bodyHtml, sample } = await req.json();
  const to = String(testEmail ?? "").trim().toLowerCase();
  const domain = String(fromDomain ?? "").trim().toLowerCase();
  const localPart = String(fromLocalPart ?? "").trim().toLowerCase();

  if (!isValidEmail(to)) return apiError("Enter a valid test address.", 400);
  if (!domain || !localPart || !subject || !bodyHtml) {
    return apiError("From address, subject, and body are required.", 400);
  }
  if (!LOCAL_PART_PATTERN.test(localPart)) return apiError("From address contains invalid characters.", 400);
  if (replyTo && !isValidEmail(replyTo)) return apiError("Reply-to must be a valid email address.", 400);

  const senders = await loadSenderDomains(auth.workspaceId);
  if (!senders.some((s) => s.domain === domain)) {
    return apiError("That domain isn't ready to send from yet (it needs an active approved sender).", 403);
  }

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
      bodyHtml,
      publicBaseUrl: publicBaseUrl(req),
    },
    // Rendered with the sample recipient's data, but delivered to the
    // test address -- and the unsubscribe link targets the test address
    // too, so clicking it can't unsubscribe the real sample recipient.
    { email: to, name: sample?.name ?? "", vars: { ...sampleVars, email: sample?.email ?? to } }
  );

  try {
    const result = await sendEmail(message);
    if (result.suppressed) {
      return apiError(`${to} is on Oracle's suppression list (a prior bounce or complaint), so it wasn't delivered.`, 409);
    }
    return apiSuccess({ messageId: result.messageId }, `Test sent to ${to}.`);
  } catch (err) {
    return apiError(`Test send failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
