// app/api/email/forms/[id]/signups/route.ts
//
// Session-cookie protected. GET lists the people who confirmed through a
// signup form, newest first -- the contacts on the form's list that the
// confirm route tagged with this form.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { SignupForm } from "@/lib/models/SignupForm";
import { ContactList } from "@/lib/models/ContactList";

const LIMIT = 500;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return apiError("Form not found.", 404);

  const form = await SignupForm.findOne({ _id: id, workspaceId: auth.workspaceId }).select("name listId").lean();
  if (!form) return apiError("Form not found.", 404);
  if (!mongoose.isValidObjectId(form.listId)) return apiSuccess({ signups: [], total: 0 });

  // Signups from before contacts were tagged with the form id only carry
  // the form's name.
  const fromThisForm = {
    $or: [
      { "contacts.vars.signup_form_id": id },
      { "contacts.vars.signup_form_id": { $exists: false }, "contacts.vars.signup_form": form.name },
    ],
  };
  const [result] = await ContactList.aggregate<{ total: { n: number }[]; rows: { email: string; name?: string; subscribedAt?: string }[] }>([
    { $match: { _id: new mongoose.Types.ObjectId(form.listId), workspaceId: auth.workspaceId } },
    { $unwind: "$contacts" },
    { $match: fromThisForm },
    {
      $facet: {
        total: [{ $count: "n" }],
        rows: [
          { $sort: { "contacts.vars.subscribed_at": -1 } },
          { $limit: LIMIT },
          { $project: { _id: 0, email: "$contacts.email", name: "$contacts.name", subscribedAt: "$contacts.vars.subscribed_at" } },
        ],
      },
    },
  ]);
  return apiSuccess({ signups: result?.rows ?? [], total: result?.total[0]?.n ?? 0 });
}
