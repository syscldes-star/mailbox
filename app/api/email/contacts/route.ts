// app/api/email/contacts/route.ts
//
// Session-cookie protected. GET ?email=x returns one contact's profile
// within this workspace: every bulk email they were sent (with opens and
// clicks), the saved lists they're on, and their do-not-email status.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { visibleTo, workVisibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { BulkRecipient } from "@/lib/models/BulkRecipient";
import { BulkEmailJob } from "@/lib/models/BulkEmailJob";
import { ContactList } from "@/lib/models/ContactList";
import { EmailSuppression } from "@/lib/models/EmailSuppression";
import { isValidEmail } from "@/lib/bulk-email/recipients";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

const MAX_HISTORY = 200;

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!isValidEmail(email)) return apiError("Enter a valid email address.", 400);
  const workspaceId = auth.workspaceId;

  // A member only sees this contact's history from sends they can see,
  // and the lists they can see; the owner sees everything.
  const jobScope = await workVisibleTo(auth);
  const recipientFilter: Record<string, unknown> = { workspaceId, email };
  if ("$or" in jobScope) recipientFilter.jobId = { $in: await BulkEmailJob.find(jobScope).distinct("_id") };

  const [received, suppression, lists] = await Promise.all([
    BulkRecipient.find(recipientFilter)
      .sort({ _id: -1 })
      .limit(MAX_HISTORY)
      .select("jobId name status error sentAt openedAt openCount clickedAt clickCount clickedLinks deliveryIssue")
      .lean(),
    EmailSuppression.findOne({ workspaceId, email }).select("reason note createdAt").lean(),
    ContactList.find({ ...visibleTo(auth), "contacts.email": email }, { name: 1, contacts: { $elemMatch: { email } } }).lean(),
  ]);

  const jobs = new Map(
    (await BulkEmailJob.find({ _id: { $in: received.map((r) => r.jobId) } }).select("subject createdAt").lean()).map((j) => [
      String(j._id),
      j,
    ])
  );

  const sends = received.map((r) => {
    const job = jobs.get(String(r.jobId));
    return {
      jobId: String(r.jobId),
      subject: job?.subject ?? "(deleted send)",
      createdAt: job?.createdAt,
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
      openedAt: r.openedAt,
      openCount: r.openCount ?? 0,
      clickedAt: r.clickedAt,
      clickCount: r.clickCount ?? 0,
      clickedLinks: r.clickedLinks ?? [],
      deliveryIssue: r.deliveryIssue,
    };
  });

  // Name and extra fields from the most recent source that has them.
  const listContact = lists.flatMap((l) => l.contacts ?? [])[0];
  const name = listContact?.name || received.find((r) => r.name)?.name || "";

  const delivered = sends.filter((s) => s.status === "sent");
  return apiSuccess({
    email,
    name,
    fields: listContact?.vars ?? {},
    suppression: suppression ? { reason: suppression.reason, note: suppression.note, since: suppression.createdAt } : null,
    lists: lists.map((l) => ({ id: String(l._id), name: l.name })),
    totals: {
      sent: delivered.length,
      opened: delivered.filter((s) => s.openedAt).length,
      clicked: delivered.filter((s) => s.clickedAt).length,
      lastOpenedAt: delivered.map((s) => s.openedAt).filter(Boolean).sort().pop() ?? null,
    },
    sends,
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}
