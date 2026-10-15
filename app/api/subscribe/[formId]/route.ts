// app/api/subscribe/[formId]/route.ts
//
// Public (no session). GET renders the hosted signup form; POST receives
// a signup (form-encoded from the hosted/embedded HTML form, or JSON from
// a site's own script) and emails a confirmation link. Nobody is added to
// the list until they confirm (double opt-in).
//
// The response is the same whether or not the address is already
// subscribed or suppressed, so the form can't be used to probe who is on
// a list.

import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/mongodb";
import { SignupForm } from "@/lib/models/SignupForm";
import { EmailSuppression } from "@/lib/models/EmailSuppression";
import { isValidEmail } from "@/lib/bulk-email/recipients";
import { escapeHtml } from "@/lib/bulk-email/template";
import { allow, publicPage, sendConfirmationEmail, signConfirmToken, verifyFormEmail } from "@/lib/bulk-email/subscribe";
import { ContactList } from "@/lib/models/ContactList";
import { getEmailSettings } from "@/lib/bulk-email/settings";
import { publicBaseUrl } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ formId: string }> };

const HONEYPOT = "hp_x7";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

async function loadForm(formId: string) {
  if (!mongoose.isValidObjectId(formId)) return null;
  await connectToDatabase();
  return SignupForm.findOne({ _id: formId, active: true });
}

/** On the form's list and not unsubscribed, bounced or blocked. */
async function isSubscribed(form: { listId: string; workspaceId: string }, email: string) {
  if (!mongoose.isValidObjectId(form.listId)) return false;
  const [onList, suppressed] = await Promise.all([
    ContactList.exists({ _id: form.listId, workspaceId: form.workspaceId, "contacts.email": email }),
    EmailSuppression.exists({ workspaceId: form.workspaceId, email }),
  ]);
  return !!onList && !suppressed;
}

function alreadySubscribedPage(form: { heading: string }, email: string) {
  return publicPage(
    "Already subscribed",
    `<h1>You're already subscribed</h1><p><strong>${escapeHtml(email)}</strong> is already subscribed to ${escapeHtml(form.heading)}. There's nothing more to do.</p>`
  );
}

function formHtml(
  form: { heading: string; description?: string; buttonText: string; askName: boolean },
  action: string,
  error?: string,
  prefill: { email?: string; name?: string; signature?: string } = {}
) {
  const value = (v?: string) => (v ? ` value="${escapeHtml(v)}"` : "");
  return (
    `<h1>${escapeHtml(form.heading)}</h1>` +
    (form.description ? `<p>${escapeHtml(form.description)}</p>` : "") +
    (error ? `<p style="color:#dc2626">${escapeHtml(error)}</p>` : "") +
    `<form method="post" action="${escapeHtml(action)}">` +
    (form.askName ? `<label for="name">Name</label><input id="name" name="name" type="text" autocomplete="name" maxlength="200"${value(prefill.name)}>` : "") +
    `<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"${value(prefill.email)}>` +
    // Honeypot: hidden from people, filled in by most bots. Deliberately
    // not named or labelled like anything a browser autofills (it used to
    // be "website", which Chrome filled in for real people).
    `<div class="hp" aria-hidden="true"><label for="${HONEYPOT}">Leave this empty</label><input id="${HONEYPOT}" name="${HONEYPOT}" type="text" tabindex="-1" autocomplete="off" data-lpignore="true" data-1p-ignore></div>` +
    (prefill.signature ? `<input type="hidden" name="k" value="${escapeHtml(prefill.signature)}">` : "") +
    `<button type="submit">${escapeHtml(form.buttonText || "Subscribe")}</button>` +
    `</form><p class="small">We'll email you a link to confirm. You can unsubscribe at any time.</p>`
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
  const { formId } = await params;
  const form = await loadForm(formId);
  if (!form) return publicPage("Form not available", "<h1>Form not available</h1><p>This signup form doesn't exist or has been turned off.</p>", 404);
  // ?email=... (and ?name=...) fill the form in -- the "Insert signup
  // form" button in Compose links here with the reader's address. Emails
  // can't contain spaces, so a space is a "+" that got decoded.
  const q = req.nextUrl.searchParams;
  const email = (q.get("email") ?? "").trim().replace(/ /g, "+").slice(0, 254);
  const name = (q.get("name") ?? "").trim().slice(0, 200);
  const signature = q.get("k") ?? "";
  const signed = isValidEmail(email) && verifyFormEmail(formId, email.toLowerCase(), signature);
  // Opened from their own email (signed link) and already on the list.
  if (signed && (await isSubscribed(form, email.toLowerCase()))) return alreadySubscribedPage(form, email);
  const prefill = { email: isValidEmail(email) ? email : undefined, name: name || undefined, signature: signed ? signature : undefined };
  return publicPage(form.heading, formHtml(form, req.nextUrl.pathname, undefined, prefill));
}

export async function POST(req: NextRequest, { params }: Params) {
  const { formId } = await params;
  const wantsJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const reply = (ok: boolean, message: string, status = 200) =>
    wantsJson
      ? NextResponse.json({ ok, message }, { status, headers: CORS })
      : publicPage(ok ? "Check your inbox" : "Couldn't sign you up", `<h1>${ok ? "Check your inbox" : "Couldn't sign you up"}</h1><p>${escapeHtml(message)}</p>`, status);

  const form = await loadForm(formId);
  if (!form) return reply(false, "This signup form doesn't exist or has been turned off.", 404);

  let email = "";
  let name = "";
  let honeypot = "";
  let signature = "";
  try {
    if (wantsJson) {
      const body = await req.json();
      email = String(body.email ?? "");
      name = String(body.name ?? "");
      honeypot = String(body[HONEYPOT] ?? body.website ?? "");
      signature = String(body.k ?? "");
    } else {
      const body = await req.formData();
      email = String(body.get("email") ?? "");
      name = String(body.get("name") ?? "");
      // "website" is the honeypot name in older embed snippets.
      honeypot = String(body.get(HONEYPOT) ?? body.get("website") ?? "");
      signature = String(body.get("k") ?? "");
    }
  } catch {
    return reply(false, "Something went wrong reading the form -- please try again.", 400);
  }
  email = email.trim().toLowerCase();
  name = name.trim().slice(0, 200);

  const confirmMessage = `We've sent a confirmation link to ${email}. Click it to finish subscribing.`;

  if (!isValidEmail(email)) {
    if (wantsJson) return reply(false, "Please enter a valid email address.", 400);
    return publicPage(form.heading, formHtml(form, req.nextUrl.pathname, "Please enter a valid email address."), 400);
  }
  // Bots: pretend it worked, do nothing.
  // Logged so a real person caught by it shows up in the server log.
  if (honeypot) {
    console.warn(`[signup] no confirmation sent to ${email} (form ${formId}): hidden spam-trap field was filled in`);
    return reply(true, confirmMessage);
  }

  // Submitted from a signed link (their own email) and already subscribed:
  // say so instead of sending another confirmation. Unsigned submissions
  // get the usual reply, so the form can't be used to probe a list.
  if (signature && verifyFormEmail(formId, email, signature) && (await isSubscribed(form, email))) {
    if (wantsJson) return reply(true, `${email} is already subscribed.`);
    return alreadySubscribedPage(form, email);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!allow(`ip:${ip}`, 20, 60 * 60 * 1000) || !allow(`form:${formId}`, 500, 60 * 60 * 1000)) {
    return reply(false, "Too many signups from here -- please try again later.", 429);
  }
  // Silently cap confirmation emails per address (stops using the form
  // to flood someone's inbox).
  if (!allow(`email:${email}`, 3, 24 * 60 * 60 * 1000)) {
    console.warn(`[signup] no confirmation sent to ${email} (form ${formId}): already sent 3 in the last 24 hours`);
    return reply(true, confirmMessage);
  }

  // Addresses that bounced or reported spam never get a confirmation.
  const blocked = await EmailSuppression.exists({ workspaceId: form.workspaceId, email, reason: { $in: ["bounced", "complained"] } });
  if (blocked) {
    console.warn(`[signup] no confirmation sent to ${email} (form ${formId}): address previously bounced or reported spam`);
  } else {
    const confirmUrl = `${publicBaseUrl(req).replace(/\/+$/, "")}/api/subscribe/confirm?t=${encodeURIComponent(signConfirmToken(formId, email, name))}`;
    const { postalAddress } = await getEmailSettings(form.workspaceId);
    try {
      const result = await sendConfirmationEmail(form, email, confirmUrl, postalAddress);
      console.log(
        result.suppressed
          ? `[signup] confirmation to ${email} (form ${formId}) dropped by Oracle: address is on its suppression list`
          : `[signup] confirmation sent to ${email} (form ${formId}), message id ${result.messageId}`
      );
    } catch (err) {
      console.error("[signup] confirmation email failed", err);
      return reply(false, "We couldn't send the confirmation email right now -- please try again later.", 502);
    }
  }
  return reply(true, confirmMessage);
}
