// app/api/unsubscribe/route.ts
//
// Public (no session) -- recipients reach this from the link in a bulk
// email's footer or their mail client's built-in unsubscribe button.
// GET shows a confirmation page rather than unsubscribing outright, since
// link scanners and previewers prefetch URLs; POST performs it, and is
// also what RFC 8058 one-click (List-Unsubscribe-Post) sends.

import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import mongoose from "mongoose";
import { EmailSuppression } from "@/lib/models/EmailSuppression";
import { BulkRecipient } from "@/lib/models/BulkRecipient";
import { incCounts } from "@/lib/models/BulkEmailJob";
import { verifyUnsubscribeToken } from "@/lib/bulk-email/unsubscribe";
import { escapeHtml } from "@/lib/bulk-email/template";

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;width:100%;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#64748b;font-size:14px;line-height:1.5}
button{margin-top:16px;background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer}</style>
</head><body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function invalid() {
  return page("Link not valid", "<p>This unsubscribe link is invalid or incomplete.</p>", 400);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return invalid();

  return page(
    "Unsubscribe",
    `<p>Stop receiving these emails at <strong>${escapeHtml(payload.email)}</strong>?</p>
<form method="post" action="?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`
  );
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return invalid();

  await connectToDatabase();
  await EmailSuppression.updateOne(
    { workspaceId: payload.workspaceId, email: payload.email },
    { $setOnInsert: { workspaceId: payload.workspaceId, email: payload.email, reason: "unsubscribed" } },
    { upsert: true }
  );

  // Credit the email the link came from (once per person), for the
  // Overview's "most unsubscribes" ranking.
  if (payload.jobId && mongoose.isValidObjectId(payload.jobId)) {
    const marked = await BulkRecipient.updateOne(
      { jobId: payload.jobId, email: payload.email, unsubscribedAt: null },
      { $set: { unsubscribedAt: new Date() } }
    );
    if (marked.modifiedCount === 1) await incCounts(payload.jobId, { unsubscribed: 1 });
  }

  return page("You're unsubscribed", `<p><strong>${escapeHtml(payload.email)}</strong> won't receive these emails anymore.</p>`);
}
