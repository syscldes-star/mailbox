// lib/bulk-email/sender.ts
//
// Sends one message through OCI Email Delivery's HTTPS submission API
// (EmailDPClient.submitEmail). Uses the same API-key credentials as
// oracle-client.ts -- no separate SMTP credentials needed -- and the
// wildcard approved sender (@domain) that provisioning creates, so any
// local part on a provisioned domain is a valid From address.

import * as common from "oci-common";
import * as emaildp from "oci-emaildataplane";
import { buildMimeMessage, type MimeAttachment } from "./mime";

let cachedClient: emaildp.EmailDPClient | null = null;

function getClient(): emaildp.EmailDPClient {
  if (cachedClient) return cachedClient;
  const privateKey = (process.env.OCI_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const provider = new common.SimpleAuthenticationDetailsProvider(
    process.env.OCI_TENANCY_OCID!,
    process.env.OCI_USER_OCID!,
    process.env.OCI_FINGERPRINT!,
    privateKey,
    null,
    common.Region.fromRegionId(process.env.OCI_REGION!)
  );
  // The SDK's own retries are off: by default it retries a failing call
  // up to 8 times over ~2 minutes, silently. sendEmail's caller already
  // retries briefly (sendWithRetry), and a send stuck that long would
  // look stalled to the resume logic.
  cachedClient = new emaildp.EmailDPClient(
    { authenticationDetailsProvider: provider },
    { retryConfiguration: common.NoRetryConfigurationDetails }
  );
  return cachedClient;
}

export interface OutgoingEmail {
  from: { email: string; name?: string };
  to: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  /** Adds RFC 8058 one-click List-Unsubscribe headers -- Gmail and
   * Yahoo require these for bulk senders. */
  unsubscribeUrl?: string;
  /** When present, the message is built as MIME and sent through OCI's
   * raw submission API (the JSON API has no attachment support). */
  attachments?: MimeAttachment[];
}

export interface SendResult {
  messageId?: string;
  suppressed: boolean;
}

export class SendError extends Error {
  retryable: boolean;
  /** Oracle's sending-rate limit was hit: "minute" clears by itself in a
   * minute (wait and retry); "day" won't clear until tomorrow. */
  rateLimited: "minute" | "day" | null;
  constructor(message: string, retryable: boolean, rateLimited: "minute" | "day" | null = null) {
    super(message);
    this.name = "SendError";
    this.retryable = retryable;
    this.rateLimited = rateLimited;
  }
}

export async function sendEmail(message: OutgoingEmail): Promise<SendResult> {
  const headerFields: Record<string, string> = {};
  if (message.unsubscribeUrl) {
    headerFields["List-Unsubscribe"] = `<${message.unsubscribeUrl}>`;
    headerFields["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    if (message.attachments && message.attachments.length > 0) {
      // The SDK can only sign a string or a stream body -- a Buffer fails
      // with "Unable to read body content". The MIME is pure ASCII (every
      // part is base64, headers are RFC 2047-encoded), so a string is exact.
      const raw = buildMimeMessage({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.bodyHtml,
        text: message.bodyText,
        headers: headerFields,
        attachments: message.attachments,
      }).toString("ascii");
      const response = await getClient().submitRawEmail({
        contentType: emaildp.requests.SubmitRawEmailRequest.ContentType.MessageRfc822,
        compartmentId: process.env.OCI_COMPARTMENT_OCID!,
        sender: message.from.email,
        recipients: [message.to.email],
        rawMessage: raw,
        contentLength: Buffer.byteLength(raw),
      });
      const submitted = response.emailRawSubmittedResponse;
      return { messageId: submitted.messageId, suppressed: (submitted.suppressedRecipients ?? []).length > 0 };
    }

    const response = await getClient().submitEmail({
      submitEmailDetails: {
        sender: {
          senderAddress: { email: message.from.email, name: message.from.name || undefined },
          compartmentId: process.env.OCI_COMPARTMENT_OCID!,
        },
        recipients: { to: [{ email: message.to.email, name: message.to.name || undefined }] },
        replyTo: message.replyTo ? [{ email: message.replyTo }] : undefined,
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText,
        headerFields: Object.keys(headerFields).length > 0 ? headerFields : undefined,
      },
    });
    const submitted = response.emailSubmittedResponse;
    return {
      messageId: submitted.messageId,
      // OCI accepts the request but silently drops addresses on its own
      // suppression list (prior hard bounces / complaints) -- surface
      // that rather than reporting them as delivered.
      suppressed: (submitted.suppressedRecipients ?? []).length > 0,
    };
  } catch (err) {
    throw toSendError(err);
  }
}

/** Turns an OCI SDK error (a plain object, which logs as
 * "[object Object]") into a readable SendError. */
function toSendError(err: unknown): SendError {
  const e = (err ?? {}) as { statusCode?: number; serviceCode?: string; message?: string; opcRequestId?: string };
  const status = e.statusCode;
  const message = e.message || (err instanceof Error ? err.message : "") || JSON.stringify(err) || String(err);
  const parts = [status && String(status), e.serviceCode, message].filter(Boolean).join(" ");
  // 429 (rate limit), 5xx and network errors are worth retrying; 4xx
  // (bad address, unapproved sender, oversized message) will fail the
  // same way again.
  const retryable = status === undefined || status === -1 || status === 429 || status >= 500;
  // Oracle answers 400 "LimitExceeded: Maximum messages sent per minute
  // reached" (or per day) when the tenancy's sending limits are hit.
  const limitHit = status === 429 || /LimitExceeded|limit is \d+/i.test(parts);
  const rateLimited = !limitHit ? null : /per (day|24)|daily/i.test(parts) ? "day" : "minute";
  return new SendError(e.opcRequestId ? `${parts} (request ${e.opcRequestId})` : parts, retryable, rateLimited);
}
