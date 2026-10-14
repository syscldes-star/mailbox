// app/api/email/lists/[id]/route.ts
//
// Session-cookie protected. GET returns a list with all its contacts;
// PUT renames it, adds contacts (merged by email -- existing contacts are
// updated) or removes contacts; DELETE deletes the list.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { ContactList, MAX_CONTACTS_PER_LIST } from "@/lib/models/ContactList";
import { parseRecipients } from "@/lib/bulk-email/recipients";
import { MIN_SEND_ROLE } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("List not found.", 404);

  const list = await ContactList.findOne({ _id: id, workspaceId: auth.workspaceId }).lean();
  if (!list) return apiError("List not found.", 404);
  const { _id, __v, workspaceId: _w, ...rest } = list as typeof list & { __v?: number };
  return apiSuccess({ id: String(_id), ...rest });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can edit lists.", 403);
  }
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("List not found.", 404);

  const list = await ContactList.findOne({ _id: id, workspaceId: auth.workspaceId });
  if (!list) return apiError("List not found.", 404);

  const { name, addText, removeEmails } = await req.json();
  let added = 0;
  let updated = 0;
  let removed = 0;

  if (name !== undefined) {
    const trimmed = String(name).trim().slice(0, 120);
    if (!trimmed) return apiError("List name can't be empty.", 400);
    list.name = trimmed;
  }

  if (addText) {
    let parsed;
    try {
      parsed = parseRecipients(String(addText));
    } catch (err) {
      return apiError(err instanceof Error ? err.message : "Couldn't read those contacts.", 400);
    }
    const byEmail = new Map(list.contacts.map((c, i) => [c.email, i]));
    for (const r of parsed.recipients) {
      const at = byEmail.get(r.email);
      if (at === undefined) {
        list.contacts.push(r);
        byEmail.set(r.email, list.contacts.length - 1);
        added++;
      } else {
        const existing = list.contacts[at];
        existing.name = r.name || existing.name;
        existing.vars = { ...(existing.vars ?? {}), ...r.vars };
        updated++;
      }
    }
    list.columns = [...new Set([...list.columns, ...parsed.columns])];
    if (list.contacts.length > MAX_CONTACTS_PER_LIST) {
      return apiError(`A list can hold up to ${MAX_CONTACTS_PER_LIST.toLocaleString()} contacts.`, 400);
    }
  }

  if (Array.isArray(removeEmails) && removeEmails.length > 0) {
    const drop = new Set(removeEmails.map((e: unknown) => String(e).toLowerCase()));
    const before = list.contacts.length;
    list.contacts = list.contacts.filter((c) => !drop.has(c.email));
    removed = before - list.contacts.length;
  }

  list.markModified("contacts");
  await list.save();
  return apiSuccess({ id, count: list.contacts.length, added, updated, removed }, "List updated.");
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can delete lists.", 403);
  }
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("List not found.", 404);

  const result = await ContactList.deleteOne({ _id: id, workspaceId: auth.workspaceId });
  if (result.deletedCount === 0) return apiError("List not found.", 404);
  return apiSuccess({ id }, "List deleted.");
}
