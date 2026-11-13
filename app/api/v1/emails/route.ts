import { NextRequest, NextResponse } from "next/server";
import { emailKeyAuth } from "@/lib/integrations/guard";
import { BulkRecipient } from "@/lib/models/BulkRecipient";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { Campaign } from "@/lib/models/Campaign";

/** GET /api/v1/emails?email=<address>&limit= -- the bulk emails sent to
 * one address, newest first (up to 100): subject, campaign, when, and
 * whether it was delivered, opened and clicked. */
export async function GET(req: NextRequest) {
  const k = await emailKeyAuth(req);
  if (!k) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Send ?email= with the address." }, { status: 400 });
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  const list = await BulkRecipient.find({ workspaceId: k.key.workspaceId, email }).sort({ _id: -1 }).limit(limit).lean();
  const jobs = new Map((await BulkEmailJob.find({ _id: { $in: list.map((r) => r.jobId) } }).select("subject campaignId fromLocalPart fromDomain createdAt").lean()).map((j) => [String(j._id), j]));
  const campaigns = new Map((await Campaign.find({ _id: { $in: [...jobs.values()].map((j) => j.campaignId).filter(Boolean) } }).select("name").lean()).map((c) => [String(c._id), c.name]));
  return NextResponse.json({
    data: list.map((r) => {
      const job = jobs.get(String(r.jobId));
      return {
        id: String(r._id),
        subject: job?.subject ?? "",
        campaign: job?.campaignId ? (campaigns.get(job.campaignId) ?? "") : "",
        from: job ? `${job.fromLocalPart}@${job.fromDomain}` : "",
        status: r.status,
        sentAt: r.sentAt ?? null,
        openedAt: r.openedAt ?? null,
        clickedAt: r.clickedAt ?? null,
        opens: r.openCount ?? 0,
        clicks: r.clickCount ?? 0,
        clickedLinks: r.clickedLinks ?? [],
      };
    }),
  });
}
