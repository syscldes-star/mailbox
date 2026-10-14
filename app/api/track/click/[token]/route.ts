// app/api/track/click/[token]/route.ts
//
// Public (no session) -- every tracked link in a bulk email points here.
// Records the click, then redirects to the real destination. The token's
// signature covers the destination URL, so a tampered or made-up link
// gets an error page instead of a redirect (no open redirect).

import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { verifyClickToken } from "@/lib/bulk-email/tracking";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = req.nextUrl.searchParams.get("u") ?? "";
  const parsed = verifyClickToken(token, url);
  if (!parsed) {
    return new NextResponse("This link is invalid or has been modified.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    await connectToDatabase();
    const path = `recipients.${parsed.index}`;
    const now = new Date();
    const sent = { _id: parsed.jobId, [`${path}.status`]: "sent" };
    await BulkEmailJob.updateOne(sent, {
      $inc: { [`${path}.clickCount`]: 1 },
      $set: { [`${path}.lastClickedAt`]: now },
      $addToSet: { [`${path}.clickedLinks`]: url.slice(0, 2000) },
    });
    await BulkEmailJob.updateOne({ ...sent, [`${path}.clickedAt`]: null }, { $set: { [`${path}.clickedAt`]: now } });
    // A click proves the email was opened, even when the mail app
    // blocked the tracking pixel.
    await BulkEmailJob.updateOne({ ...sent, [`${path}.openedAt`]: null }, { $set: { [`${path}.openedAt`]: now } });
  } catch (err) {
    // Never block the person from reaching the link over a tracking error.
    console.error("[bulk-email] failed to record click", err);
  }

  return NextResponse.redirect(url, 302);
}
