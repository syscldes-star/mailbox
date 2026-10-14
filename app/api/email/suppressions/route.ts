// app/api/email/suppressions/route.ts
//
// Session-cookie protected. The workspace's do-not-email list.
// GET ?q=&reason=&page= lists entries; POST {emails, note} adds addresses
// by hand (pasted or imported); DELETE ?email= removes one.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailSuppression, SUPPRESSION_REASONS, type SuppressionReason } from "@/lib/models/EmailSuppression";
import { isValidEmail } from "@/lib/bulk-email/recipients";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

const PAGE_SIZE = 50;
const MAX_IMPORT = 10000;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const reason = req.nextUrl.searchParams.get("reason") ?? "";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);

  const filter: Record<string, unknown> = { workspaceId: auth.workspaceId };
  if (q) filter.email = { $regex: escapeRegex(q) };
  if (SUPPRESSION_REASONS.includes(reason as SuppressionReason)) filter.reason = reason;

  const [items, total, counts] = await Promise.all([
    EmailSuppression.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select("email reason note createdAt")
      .lean(),
    EmailSuppression.countDocuments(filter),
    EmailSuppression.aggregate<{ _id: string; count: number }>([
      { $match: { workspaceId: auth.workspaceId } },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
    ]),
  ]);

  return apiSuccess({
    items: items.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })),
    total,
    page,
    pageSize: PAGE_SIZE,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can edit the do-not-email list.", 403);
  }

  const { emails, note } = await req.json();
  const candidates = String(emails ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase().replace(/^<|>$/g, ""))
    .filter(Boolean);
  const valid = [...new Set(candidates.filter(isValidEmail))];
  const invalid = candidates.length - candidates.filter(isValidEmail).length;

  if (valid.length === 0) return apiError("No valid email addresses found.", 400);
  if (valid.length > MAX_IMPORT) return apiError(`Import up to ${MAX_IMPORT.toLocaleString()} addresses at a time.`, 400);

  const result = await EmailSuppression.bulkWrite(
    valid.map((email) => ({
      updateOne: {
        filter: { workspaceId: auth.workspaceId, email },
        update: {
          $setOnInsert: {
            workspaceId: auth.workspaceId,
            email,
            reason: "manual",
            note: note ? String(note).slice(0, 200) : undefined,
          },
        },
        upsert: true,
      },
    }))
  );

  const added = result.upsertedCount;
  return apiSuccess(
    { added, alreadyListed: valid.length - added, invalid },
    `Added ${added} address${added === 1 ? "" : "es"}.`
  );
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can edit the do-not-email list.", 403);
  }

  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) return apiError("email query param required.", 400);

  const result = await EmailSuppression.deleteOne({ workspaceId: auth.workspaceId, email });
  if (result.deletedCount === 0) return apiError("That address isn't on the list.", 404);
  return apiSuccess({ email }, `${email} removed. Future sends will include it again.`);
}
