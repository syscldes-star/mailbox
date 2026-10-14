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
import { htmlToText, renderTemplate, withFooter, withPreheader } from "./template";
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
  preheader?: string;
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
  const rendered = renderTemplate(withPreheader(withFooter(source.bodyHtml, source.postalAddress), source.preheader), vars, { html: true });
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

    // In an undecided A/B test only the test group goes out now; the
    // rest wait for the winning subject.
    const winner = job.abTest?.winner;
    const pending = job.recipients
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => r.status === "pending" && (r.variant !== "rest" || !!winner));
    const subjectFor = (variant?: string) =>
      variant === "B" || (variant === "rest" && winner === "B") ? job.abTest!.subjectB : job.subject;

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
                buildMessage({ ...job, subject: subjectFor(r.variant) }, r, {
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

    const waitingForWinner = !!job.abTest && !winner && job.recipients.some((r) => r.variant === "rest" && r.status === "pending");
    await BulkEmailJob.updateOne(
      { _id: jobId, status: "sending" },
      waitingForWinner
        ? { $set: { status: "testing" }, $unset: { heartbeatAt: 1 } }
        : { $set: { status: "completed", completedAt: new Date() }, $unset: { heartbeatAt: 1 } }
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

/** Moves scheduled jobs whose time has come to "sending" and starts
 * them. The status flip is atomic, so a job only ever starts once. */
export async function startDueScheduledJobs(): Promise<number> {
  const due = await BulkEmailJob.find({ status: "scheduled", scheduledAt: { $lte: new Date() } }).select("_id");
  let started = 0;
  for (const { _id } of due) {
    const flipped = await BulkEmailJob.updateOne({ _id, status: "scheduled" }, { $set: { status: "sending" } });
    if (flipped.modifiedCount === 1) {
      startBulkJob(String(_id));
      started++;
    }
  }
  return started;
}

/** Rate of the A/B metric for one variant, among recipients sent to. */
export function variantStats(recipients: IBulkRecipient[], variant: "A" | "B") {
  const group = recipients.filter((r) => r.variant === variant && r.status === "sent");
  const opened = group.filter((r) => r.openedAt).length;
  const clicked = group.filter((r) => r.clickedAt).length;
  return {
    sent: group.length,
    opened,
    clicked,
    openRate: group.length ? opened / group.length : 0,
    clickRate: group.length ? clicked / group.length : 0,
  };
}

/** Picks an A/B winner (by the test's metric unless `force` names one),
 * then sends the winning subject to everyone else. A tie goes to A. */
export async function decideAbTest(jobId: string, force?: "A" | "B", by: "auto" | "manual" = "auto"): Promise<"A" | "B" | null> {
  const job = await BulkEmailJob.findById(jobId).lean();
  if (!job?.abTest || job.abTest.winner || job.status !== "testing") return null;
  let winner = force;
  if (!winner) {
    const a = variantStats(job.recipients, "A");
    const b = variantStats(job.recipients, "B");
    const key = job.abTest.metric === "clicks" ? "clickRate" : "openRate";
    winner = b[key] > a[key] ? "B" : "A";
  }
  const decided = await BulkEmailJob.updateOne(
    // Only once the test group has finished ("testing"): deciding while it
    // is still sending would start a second worker alongside the first.
    { _id: jobId, "abTest.winner": null, status: "testing" },
    {
      $set: {
        "abTest.winner": winner,
        "abTest.decidedAt": new Date(),
        "abTest.decidedBy": by,
        status: "sending",
      },
      $unset: { heartbeatAt: 1 },
    }
  );
  if (decided.modifiedCount !== 1) return null;
  startBulkJob(jobId);
  return winner;
}

/** Decides every A/B test whose waiting time is over. */
export async function decideDueAbTests(): Promise<number> {
  const due = await BulkEmailJob.find({ status: "testing", "abTest.decideAt": { $lte: new Date() }, "abTest.winner": null }).select("_id");
  let decided = 0;
  for (const { _id } of due) if (await decideAbTest(String(_id))) decided++;
  return decided;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
