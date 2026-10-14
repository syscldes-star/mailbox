// app/api/subscribe/confirm/route.ts
//
// Public (no session). The link in a signup confirmation email. GET shows
// a "Confirm" button rather than confirming outright, since email
// security scanners open links automatically -- a real person has to
// click. POST adds them to the form's list.

import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/mongodb";
import { SignupForm } from "@/lib/models/SignupForm";
import { ContactList, MAX_CONTACTS_PER_LIST } from "@/lib/models/ContactList";
import { EmailSuppression } from "@/lib/models/EmailSuppression";
import { escapeHtml } from "@/lib/bulk-email/template";
import { publicPage, verifyConfirmToken } from "@/lib/bulk-email/subscribe";

function invalid() {
  return publicPage(
    "Link expired",
    "<h1>Link not valid</h1><p>This confirmation link is invalid or has expired. Please sign up again.</p>",
    400
  );
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const payload = verifyConfirmToken(token);
  if (!payload) return invalid();
  return publicPage(
    "Confirm subscription",
    `<h1>Confirm your subscription</h1><p>Subscribe <strong>${escapeHtml(payload.email)}</strong>?</p>` +
      `<form method="post" action="?t=${encodeURIComponent(token)}"><button type="submit">Yes, subscribe me</button></form>`
  );
}

export async function POST(req: NextRequest) {
  const payload = verifyConfirmToken(req.nextUrl.searchParams.get("t") ?? "");
  if (!payload) return invalid();

  await connectToDatabase();
  const form = await SignupForm.findById(payload.formId);
  if (!form || !form.active) {
    return publicPage("Form closed", "<h1>Signups closed</h1><p>This signup form has been turned off.</p>", 410);
  }

  const now = new Date().toISOString();
  const vars = { signup_form: form.name, subscribed_at: now, signup_form_id: String(form._id) };
  // Update the contact if they're already on the list, otherwise add them.
  const updated = await ContactList.updateOne(
    { _id: form.listId, workspaceId: form.workspaceId, "contacts.email": payload.email },
    {
      $set: {
        ...(payload.name ? { "contacts.$.name": payload.name } : {}),
        "contacts.$.vars.signup_form": vars.signup_form,
        "contacts.$.vars.subscribed_at": vars.subscribed_at,
        "contacts.$.vars.signup_form_id": vars.signup_form_id,
      },
    }
  );
  let added = false;
  if (updated.matchedCount === 0) {
    const pushed = await ContactList.updateOne(
      {
        _id: form.listId,
        workspaceId: form.workspaceId,
        "contacts.email": { $ne: payload.email },
        [`contacts.${MAX_CONTACTS_PER_LIST - 1}`]: { $exists: false },
      },
      {
        $push: { contacts: { email: payload.email, name: payload.name, vars } },
        $addToSet: { columns: { $each: ["signup_form", "subscribed_at"] } },
      }
    );
    if (pushed.matchedCount === 0) {
      const list = await ContactList.exists({ _id: form.listId, workspaceId: form.workspaceId });
      return publicPage(
        "Couldn't subscribe",
        `<h1>Couldn't subscribe</h1><p>${list ? "This list is full." : "This signup form's list no longer exists."} Please contact the sender.</p>`,
        409
      );
    }
    added = true;
  }

  // Confirming is fresh consent: lift a previous unsubscribe. Bounces and
  // spam complaints stay -- those need a person to review.
  await EmailSuppression.deleteOne({ workspaceId: form.workspaceId, email: payload.email, reason: "unsubscribed" });
  if (added) await SignupForm.updateOne({ _id: form._id }, { $inc: { signups: 1 } });

  if (form.redirectUrl && /^https?:\/\//i.test(form.redirectUrl)) {
    return NextResponse.redirect(form.redirectUrl, 303);
  }
  return publicPage("Subscribed", `<h1>You're subscribed</h1><p>Thanks -- <strong>${escapeHtml(payload.email)}</strong> is now subscribed to ${escapeHtml(form.heading)}.</p>`);
}
