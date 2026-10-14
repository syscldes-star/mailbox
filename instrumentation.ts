// instrumentation.ts
//
// Next.js calls register() once when the server process starts. Used to
// start the Bulk Email background scheduler (lib/bulk-email/scheduler.ts).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/bulk-email/scheduler");
    startScheduler();
  }
}
