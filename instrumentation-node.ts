// instrumentation-node.ts
//
// Server-start tasks for the Node.js runtime (loaded from
// instrumentation.ts): move older bulk sends to the BulkRecipient
// collection (one-time, idempotent), then start the Bulk Email
// background scheduler.

import { connectToDatabase } from "./lib/db/mongodb";
import { migrateEmbeddedRecipients } from "./lib/bulk-email/recipient-store";
import { startScheduler } from "./lib/bulk-email/scheduler";

export async function onServerStart() {
  try {
    await connectToDatabase();
    const moved = await migrateEmbeddedRecipients();
    if (moved) console.log(`[bulk-email] moved recipients of ${moved} older send(s) to their own collection`);
  } catch (err) {
    // Never block the server from starting; the next start retries.
    console.error("[bulk-email] recipient migration failed", err);
  }
  startScheduler();
}
