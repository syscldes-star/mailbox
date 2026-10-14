// lib/bulk-email/sender.ts
//
// Sends one message through OCI Email Delivery's HTTPS submission API
// (EmailDPClient.submitEmail). Uses the same API-key credentials as
// oracle-client.ts -- no separate SMTP credentials needed -- and the
// wildcard approved sender (@domain) that provisioning creates, so any
// local part on a provisioned domain is a valid From address.

import * as common from "oci-common";
import * as emaildp from "oci-emaildataplane";

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
  cachedClient = new emaildp.EmailDPClient({ authenticationDetailsProvider: provider });
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
}

export interface SendResult {
  messageId?: string;
  suppressed: boolean;
}

export class SendError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SendError";
    this.retryable = retryable;
  }
}

export async function sendEmail(message: OutgoingEmail): Promise<SendResult> {
  const headerFields: Record<string, string> = {};
  if (message.unsubscribeUrl) {
    headerFields["List-Unsubscribe"] = `<${message.unsubscribeUrl}>`;
    headerFields["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
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
    const status = (err as { statusCode?: number }).statusCode;
    const msg = err instanceof Error ? err.message : String(err);
    // 429 (rate limit) and 5xx are worth retrying; 4xx (bad address,
    // unapproved sender, oversized message) will fail the same way again.
    const retryable = status === undefined || status === 429 || status >= 500;
    throw new SendError(status ? `${status}: ${msg}` : msg, retryable);
  }
}
