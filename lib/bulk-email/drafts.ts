// lib/bulk-email/drafts.ts
//
// Validation shared by the draft create and update routes. Drafts are
// work in progress, so almost everything is optional -- the checks that
// matter (sender domain, recipients, attachments size) run again when
// the email is actually sent.

import { MAX_DRAFT_RECIPIENTS_CHARS } from "../models/EmailDraft";
import { parseRecipients } from "./recipients";
import { findCampaign } from "./campaigns";
import type { AuthContext } from "../api/requireAuth";

export interface DraftInput {
  campaignId?: string | null;
  fromDomain?: string;
  fromLocalPart?: string;
  fromName?: string;
  replyTo?: string;
  subject?: string;
  preheader?: string;
  bodyHtml?: string;
  recipientsText?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
  utm?: { source?: string; medium?: string; campaign?: string } | null;
  attachments?: { id?: string; filename?: string; size?: number }[];
}

export async function cleanDraftInput(auth: AuthContext, input: DraftInput) {
  const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
  const recipientsText = str(input.recipientsText, MAX_DRAFT_RECIPIENTS_CHARS + 1);
  if (recipientsText.length > MAX_DRAFT_RECIPIENTS_CHARS) {
    return { error: "That recipient list is too large to save with a draft. Save it as a list instead." };
  }
  const bodyHtml = str(input.bodyHtml, 2 * 1024 * 1024 + 1);
  if (bodyHtml.length > 2 * 1024 * 1024) return { error: "The email body is too large to save." };

  let campaignId: string | undefined;
  if (input.campaignId) {
    if (!(await findCampaign(auth, input.campaignId))) return { error: "That campaign no longer exists." };
    campaignId = input.campaignId;
  }

  const utm = input.utm
    ? { source: str(input.utm.source, 100), medium: str(input.utm.medium, 100), campaign: str(input.utm.campaign, 100) }
    : undefined;

  return {
    value: {
      campaignId,
      fromDomain: str(input.fromDomain, 253).trim().toLowerCase() || undefined,
      fromLocalPart: str(input.fromLocalPart, 64).trim().toLowerCase() || undefined,
      fromName: str(input.fromName, 100) || undefined,
      replyTo: str(input.replyTo, 254).trim() || undefined,
      subject: str(input.subject, 500),
      preheader: str(input.preheader, 300) || undefined,
      bodyHtml,
      recipientsText: recipientsText || undefined,
      recipientCount: recipientsText ? parseRecipients(recipientsText).recipients.length : 0,
      trackOpens: input.trackOpens !== false,
      trackClicks: input.trackClicks !== false,
      utm,
      attachments: (input.attachments ?? [])
        .slice(0, 10)
        .filter((a) => typeof a.id === "string")
        .map((a) => ({ id: String(a.id), filename: str(a.filename, 255), size: Number(a.size) || 0 })),
    },
  };
}
