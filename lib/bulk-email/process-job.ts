// lib/bulk-email/process-job.ts
//
// The background worker that actually delivers a bulk job. Started via
// waitUntil() right after the job is created, and restarted on demand
// (resumeStaleJobs) if the process that was running it died mid-send --
// e.g. a pm2 restart during a deploy. Progress is written per recipient,
// so a restarted worker just carries on with whoever is still "pending";
// nobody is emailed twice.

import { waitUntil } from "@vercel/functions";
import { connectToDatabase } from "../db/mongodb";
import { BulkEmailJob, type IBulkRecipient } from "../models/BulkEmailJob";
import { EmailSuppression } from "../models/EmailSuppression";
import { sendEmail, SendError, type OutgoingEmail } from "./sender";
import { htmlToText, renderTemplate, withFooter } from "./template";
import { unsubscribeUrl } from "./unsubscribe";
import { clickTrackingUrl, openPixelUrl, rewriteLinks, withOpenPixel } from "./tracking";

const CONCURRENCY = Math.max(1, Number(process.env.BULK_EMAIL_CONCURRENCY) || 5);
const RATE_PER_SECOND = Math.max(1, Number(process.env.BULK_EMAIL_RATE_PER_SECOND) || 10);
const MAX_ATTEMPTS = 3;
/** A "sending" job not touched for this long is assumed orphaned. Must
 * comfortably exceed the slowest single send including retries. */
export const HEARTBEAT_STALE_MS = 2 * 60_000;

const SKIP_REASON: Record<string, string> = {
  unsubscribed: "Unsubscribed",
  bounced: "Bounced on an earlier send",
  complained: "Marked an earlier email as spam",
  manual: "On your do-not-email list",
};

export interface MessageSource {
  workspaceId: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  bodyHtml: string;
  publicBaseUrl: string;
  postalAddress?: string;
}

/** Renders the job's template for one recipient. Shared with the
 * "send test" route so a test email matches the real thing exactly. */
export function buildMessage(
  source: MessageSource,
  recipient: Pick<IBulkRecipient, "email" | "name" | "vars">,
  tracking: { openPixel?: string; wrapLink?: (url: string) => string } = {}
): OutgoingEmail {
  const unsubscribe = unsubscribeUrl(source.publicBaseUrl, source.workspaceId, recipient.email);
  const vars = { ...(recipient.vars ?? {}), email: recipient.email, name: recipient.name ?? "", unsubscribe_url: unsubscribe };
  const rendered = renderTemplate(withFooter(source.bodyHtml, source.postalAddress), vars, { html: true });
  // Links are wrapped after rendering so merge tags inside URLs are
  // already filled in; the unsubscribe link is never wrapped.
  const linked = tracking.wrapLink
    ? rewriteLinks(rendered, tracking.wrapLink, (url) => url === unsubscribe)
    : rendered;
  const html = tracking.openPixel ? withOpenPixel(linked, tracking.openPixel) : linked;
  return {
    from: { email: `${source.fromLocalPart}@${source.fromDomain}`, name: source.fromName },
    to: { email: recipient.email, name: recipient.name },
    replyTo: source.replyTo,
    subject: renderTemplate(source.subject, vars, { html: false }),
    bodyHtml: html,
    bodyText: htmlToText(html),
    unsubscribeUrl: unsubscribe,
  };
}

async function sendWithRetry(message: OutgoingEmail) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendEmail(message);
    } catch (err) {
      if (!(err instanceof SendError) || !err.retryable || attempt >= MAX_ATTEMPTS) throw err;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

/** Atomically takes ownership of the job. Returns false if another
 * worker holds a fresh heartbeat on it, or it's no longer sending. */
async function claim(jobId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await BulkEmailJob.findOneAndUpdate(
    {
      _id: jobId,
      status: "sending",
      $or: [{ heartbeatAt: null }, { heartbeatAt: { $lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }],
    },
    { $set: { heartbeatAt: now } },
    { projection: { _id: 1 } }
  );
  return claimed !== null;
}

export async function processBulkJob(jobId: string): Promise<void> {
  await connectToDatabase();
  if (!(await claim(jobId))) return;

  try {
    const job = await BulkEmailJob.findById(jobId).lean();
    if (!job) return;

    const pending = job.recipients
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => r.status === "pending");

    const suppressed = new Map(
      (
        await EmailSuppression.find({
          workspaceId: job.workspaceId,
          email: { $in: pending.map(({ r }) => r.email) },
        }).select("email reason")
      ).map((s) => [s.email, s.reason])
    );

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const chunkStarted = Date.now();

      // Checked between chunks so Cancel takes effect within a second
      // or two rather than after the whole list.
      const current = await BulkEmailJob.findById(jobId).select("status").lean();
      if (current?.status !== "sending") return;

      const chunk = pending.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ({ r, index }) => {
          const path = `recipients.${index}`;
          let update: Record<string, unknown>;
          const suppressedReason = suppressed.get(r.email);
          if (suppressedReason) {
            update = { [`${path}.status`]: "skipped", [`${path}.error`]: SKIP_REASON[suppressedReason] };
          } else {
            try {
              const result = await sendWithRetry(
                buildMessage(job, r, {
                  openPixel: job.trackOpens ? openPixelUrl(job.publicBaseUrl, jobId, index) : undefined,
                  wrapLink: job.trackClicks
                    ? (url) => clickTrackingUrl(job.publicBaseUrl, jobId, index, url)
                    : undefined,
                })
              );
              update = result.suppressed
                ? { [`${path}.status`]: "skipped", [`${path}.error`]: "On Oracle's suppression list (prior bounce or complaint)" }
                : { [`${path}.status`]: "sent", [`${path}.messageId`]: result.messageId, [`${path}.sentAt`]: new Date() };
            } catch (err) {
              update = { [`${path}.status`]: "failed", [`${path}.error`]: (err instanceof Error ? err.message : String(err)).slice(0, 500) };
            }
          }
          await BulkEmailJob.updateOne({ _id: jobId }, { $set: { ...update, heartbeatAt: new Date() } });
        })
      );

      const minChunkMs = (chunk.length / RATE_PER_SECOND) * 1000;
      const elapsed = Date.now() - chunkStarted;
      if (elapsed < minChunkMs) await sleep(minChunkMs - elapsed);
    }

    await BulkEmailJob.updateOne(
      { _id: jobId, status: "sending" },
      { $set: { status: "completed", completedAt: new Date() }, $unset: { heartbeatAt: 1 } }
    );
  } catch (err) {
    await BulkEmailJob.updateOne(
      { _id: jobId, status: "sending" },
      {
        $set: { status: "failed", completedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
        $unset: { heartbeatAt: 1 },
      }
    );
  }
}

export function startBulkJob(jobId: string): void {
  waitUntil(processBulkJob(jobId).catch((err) => console.error(`[bulk-email] job ${jobId} crashed`, err)));
}

/** Restarts workers for any jobs (optionally just one workspace's) whose
 * worker has died. Called by the scheduler every minute, and from the
 * list/detail routes so opening the panel also recovers a stuck send. */
export async function resumeStaleJobs(workspaceId?: string): Promise<void> {
  const stale = await BulkEmailJob.find({
    ...(workspaceId ? { workspaceId } : {}),
    status: "sending",
    $or: [{ heartbeatAt: null }, { heartbeatAt: { $lt: new Date(Date.now() - HEARTBEAT_STALE_MS) } }],
  }).select("_id");
  for (const job of stale) startBulkJob(String(job._id));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
