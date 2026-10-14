// app/api/email/lists/route.ts
//
// Session-cookie protected. GET lists the workspace's saved contact lists
// (counts only, not the contacts); POST creates one from pasted text or
// CSV, parsed with the same rules as Compose.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { ContactList, MAX_CONTACTS_PER_LIST } from "@/lib/models/ContactList";
import { parseRecipients } from "@/lib/bulk-email/recipients";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

export async function GET() {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);

  const lists = await ContactList.aggregate([
    { $match: { workspaceId: auth.workspaceId } },
    { $sort: { updatedAt: -1 } },
    { $project: { name: 1, columns: 1, createdAt: 1, updatedAt: 1, count: { $size: "$contacts" } } },
  ]);
  return apiSuccess({
    lists: lists.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can create lists.", 403);
  }

  const { name, text } = await req.json();
  const trimmedName = String(name ?? "").trim().slice(0, 120);
  if (!trimmedName) return apiError("Give the list a name.", 400);

  let parsed;
  try {
    parsed = parseRecipients(String(text ?? ""));
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Couldn't read those contacts.", 400);
  }
  if (parsed.recipients.length === 0) return apiError("No valid email addresses found.", 400);
  if (parsed.recipients.length > MAX_CONTACTS_PER_LIST) {
    return apiError(`A list can hold up to ${MAX_CONTACTS_PER_LIST.toLocaleString()} contacts.`, 400);
  }

  const list = await ContactList.create({
    workspaceId: auth.workspaceId,
    name: trimmedName,
    columns: parsed.columns,
    contacts: parsed.recipients,
    createdBy: auth.userId,
  });
  return apiSuccess(
    { id: String(list._id), count: parsed.recipients.length, invalid: parsed.invalid.length, duplicates: parsed.duplicates },
    "List created.",
    201
  );
}
