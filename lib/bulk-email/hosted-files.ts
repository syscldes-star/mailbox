// lib/bulk-email/hosted-files.ts
//
// Removes hosted-file uploads that were started but never finished (tab
// closed mid-upload) after a day. Called by the scheduler.

import { EmailFile, EmailFileChunk } from "../models/EmailFile";

export async function cleanupIncompleteFiles(): Promise<void> {
  const stale = await EmailFile.find({ complete: false, createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } })
    .select("_id")
    .lean();
  if (stale.length === 0) return;
  const ids = stale.map((f) => String(f._id));
  await EmailFileChunk.deleteMany({ fileId: { $in: ids } });
  await EmailFile.deleteMany({ _id: { $in: ids } });
}
