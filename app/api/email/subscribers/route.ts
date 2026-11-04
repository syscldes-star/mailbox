// app/api/email/subscribers/route.ts
//
// Session-cookie protected. GET lists everyone who subscribed through a
// signup form, across all of the workspace's lists, newest first -- with
// the form, the list, and whether they've since unsubscribed or bounced.
// ?q= filters by email or name.

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { visibleTo } from "@/lib/visibility";
import { apiSuccess, apiError } from "@/lib/api/response";
import { ContactList } from "@/lib/models/ContactList";
import { EmailSuppression } from "@/lib/models/EmailSuppression";

const LIMIT = 1000;

interface Row {
  email: string;
  name?: string;
  form?: string;
  formId?: string;
  list: string;
  listId: string;
  subscribedAt?: string;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 200);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const search = q ? { $or: [{ "contacts.email": { $regex: escaped } }, { "contacts.name": { $regex: escaped, $options: "i" } }] } : {};

  // Subscribers of the lists this person can see.
  const [result] = await ContactList.aggregate<{ total: { n: number }[]; rows: Row[] }>([
    { $match: visibleTo(auth) },
    { $unwind: "$contacts" },
    { $match: { "contacts.vars.signup_form": { $exists: true }, ...search } },
    {
      $facet: {
        total: [{ $count: "n" }],
        rows: [
          { $sort: { "contacts.vars.subscribed_at": -1 } },
          { $limit: LIMIT },
          {
            $project: {
              _id: 0,
              email: "$contacts.email",
              name: "$contacts.name",
              form: "$contacts.vars.signup_form",
              formId: "$contacts.vars.signup_form_id",
              list: "$name",
              listId: { $toString: "$_id" },
              subscribedAt: "$contacts.vars.subscribed_at",
            },
          },
        ],
      },
    },
  ]);
  const rows = result?.rows ?? [];

  // Who has since left: unsubscribed, bounced, complained or blocked.
  const suppressed = new Map(
    (
      await EmailSuppression.find({ workspaceId: auth.workspaceId, email: { $in: [...new Set(rows.map((r) => r.email))] } })
        .select("email reason")
        .lean()
    ).map((s) => [s.email, s.reason])
  );

  return apiSuccess({
    subscribers: rows.map((r) => ({ ...r, status: suppressed.get(r.email) ?? "subscribed" })),
    total: result?.total[0]?.n ?? 0,
    limit: LIMIT,
  });
}
