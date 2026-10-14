// lib/bulk-email/scheduler.ts
//
// In-process background timer, started once per server process from
// instrumentation.ts. The app runs as a single long-lived pm2 process,
// so a plain interval is enough -- no external cron needed.
//
// Every minute: start scheduled sends that are due, pick A/B test
// winners whose waiting time is over, and restart sends whose worker
// died. Every 15 minutes: sync bounces and spam complaints from Oracle.
//
// Runs only in production by default: a local `next dev` usually points
// at the same database, and shouldn't start real sends from a laptop.
// BULK_EMAIL_SCHEDULER=on forces it on, =off forces it off.

import { connectToDatabase } from "../db/mongodb";
import { decideDueAbTests, resumeStaleJobs, startDueScheduledJobs } from "./process-job";
import { syncBounces } from "./bounces";

const TICK_MS = 60_000;
const BOUNCE_SYNC_EVERY_TICKS = 15;

declare global {
  var __bulkEmailScheduler: NodeJS.Timeout | undefined;
}

async function tick(count: number) {
  await connectToDatabase();
  await startDueScheduledJobs();
  await decideDueAbTests();
  await resumeStaleJobs();
  if (count % BOUNCE_SYNC_EVERY_TICKS === 0) {
    const result = await syncBounces();
    if (result.recipientsMarked || result.suppressionsAdded) {
      console.log(`[bulk-email] bounce sync: ${result.recipientsMarked} recipients marked, ${result.suppressionsAdded} suppressed`);
    }
  }
}

export function startScheduler(): void {
  const setting = process.env.BULK_EMAIL_SCHEDULER;
  const enabled = setting === "on" || (setting !== "off" && process.env.NODE_ENV === "production");
  if (!enabled || global.__bulkEmailScheduler) return;
  let count = 0;
  let busy = false;
  global.__bulkEmailScheduler = setInterval(async () => {
    if (busy) return; // a slow tick never overlaps the next one
    busy = true;
    try {
      await tick(count++);
    } catch (err) {
      console.error("[bulk-email] scheduler tick failed", err);
    } finally {
      busy = false;
    }
  }, TICK_MS);
  global.__bulkEmailScheduler.unref?.();
}
