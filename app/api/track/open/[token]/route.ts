// app/api/track/open/[token]/route.ts
//
// Public (no session) -- the tracking pixel embedded in bulk emails.
// Always returns the same transparent GIF, whether or not the token is
// valid, so a broken image never shows up in someone's inbox.

import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { incCounts } from "@/lib/models/BulkEmailJob";
import { BulkRecipient } from "@/lib/models/BulkRecipient";
import { verifyOpenToken } from "@/lib/bulk-email/tracking";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function pixel() {
  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      // Ask mail clients and proxies not to cache, so repeat opens are
      // counted (Gmail's image proxy may still cache for a while).
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = verifyOpenToken(token);
  if (!parsed) return pixel();

  try {
    await connectToDatabase();
    const now = new Date();
    // Only count opens for recipients the email was actually sent to.
    const sent = { jobId: parsed.jobId, index: parsed.index, status: "sent" };
    await BulkRecipient.updateOne(sent, { $inc: { openCount: 1 }, $set: { lastOpenedAt: now } });
    const first = await BulkRecipient.updateOne({ ...sent, openedAt: null }, { $set: { openedAt: now } });
    if (first.modifiedCount === 1) await incCounts(parsed.jobId, { opened: 1 });
  } catch (err) {
    console.error("[bulk-email] failed to record open", err);
  }
  return pixel();
}
