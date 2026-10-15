// lib/bulk-email/subscribe.ts
//
// Double opt-in for public signup forms: signed confirmation tokens, a
// small in-memory rate limiter, the confirmation email, and the shared
// HTML shell for the public pages.

import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { escapeHtml, emailFooterHtml, htmlToText } from "./template";
import { sendEmail } from "./sender";
import type { ISignupForm } from "../models/SignupForm";

interface ConfirmPayload {
  purpose: "subscribe";
  formId: string;
  email: string;
  name?: string;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set.");
  return secret;
}

export function signConfirmToken(formId: string, email: string, name?: string): string {
  const payload: ConfirmPayload = { purpose: "subscribe", formId, email, name: name || undefined };
  return jwt.sign(payload, getSecret(), { expiresIn: "3d" });
}

export function verifyConfirmToken(token: string): ConfirmPayload | null {
  try {
    const payload = jwt.verify(token, getSecret()) as ConfirmPayload;
    return payload.purpose === "subscribe" && payload.formId && payload.email ? payload : null;
  } catch {
    return null;
  }
}

// ---- Signed signup links ----
//
// A signup-form button in a bulk email links to the form with the
// reader's address (?email=) and this short signature (&k=). The form only
// says "you're already subscribed" when the signature matches, so nobody
// can find out who is on a list by typing addresses into the URL.

function formEmailSignature(formId: string, email: string): string {
  return createHmac("sha256", getSecret()).update(`signup:${formId}:${email.toLowerCase()}`).digest("base64url").slice(0, 16);
}

export function signFormEmail(formId: string, email: string): string {
  return formEmailSignature(formId, email);
}

export function verifyFormEmail(formId: string, email: string, signature: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(formEmailSignature(formId, email));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Adds the reader's signature to every signup-form link in a rendered
 * email that carries their address. */
export function signSignupLinks(html: string, appBase: string, email: string): string {
  const prefix = `${appBase.replace(/\/+$/, "")}/api/subscribe/`;
  return html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (whole, start: string, _q: string, raw: string) => {
    const href = raw.replace(/&amp;/g, "&");
    if (!href.startsWith(prefix)) return whole;
    try {
      const url = new URL(href);
      const formId = url.pathname.split("/").pop() ?? "";
      if (!/^[a-f0-9]{24}$/i.test(formId) || (url.searchParams.get("email") ?? "").replace(/ /g, "+").toLowerCase() !== email.toLowerCase()) return whole;
      url.searchParams.set("k", signFormEmail(formId, email));
      return `${start}"${url.toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    } catch {
      return whole;
    }
  });
}

// ---- Rate limiting (single long-lived process, so in-memory is enough) ----

const hits = new Map<string, number[]>();

/** True if `key` has been seen fewer than `max` times in `windowMs`. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return true;
}

// ---- Confirmation email ----

export async function sendConfirmationEmail(form: ISignupForm, email: string, confirmUrl: string, postalAddress: string) {
  const heading = escapeHtml(form.heading);
  const html =
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">` +
    `<h2 style="font-size:20px;margin:0 0 12px;">Please confirm your subscription</h2>` +
    `<p style="font-size:14px;line-height:1.6;color:#334155;">You (or someone using your address) signed up for <strong>${heading}</strong>. ` +
    `Click the button below to confirm. If this wasn't you, just ignore this email -- you won't be subscribed.</p>` +
    `<p style="margin:24px 0;"><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;">Confirm subscription</a></p>` +
    `<p style="font-size:12px;color:#94a3b8;">This link expires in 3 days.</p>` +
    emailFooterHtml({ postalAddress, includeUnsubscribe: false }) +
    `</div>`;
  return sendEmail({
    from: { email: `${form.fromLocalPart}@${form.fromDomain}`, name: form.fromName },
    to: { email },
    subject: `Confirm your subscription to ${form.heading}`,
    bodyHtml: html,
    bodyText: htmlToText(html),
  });
}

// ---- Public page shell ----

export function publicPage(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;box-sizing:border-box}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;width:100%}
h1{font-size:20px;margin:0 0 8px}p{color:#64748b;font-size:14px;line-height:1.5;margin:0 0 12px}
label{display:block;font-size:12px;font-weight:600;color:#475569;margin:12px 0 4px}
input[type=email],input[type=text]{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font-size:14px}
input:focus{outline:2px solid #6366f1;outline-offset:0}
button{margin-top:16px;width:100%;background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#4338ca}.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.small{font-size:12px;color:#94a3b8;margin-top:12px}
</style></head><body><div class="card">${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
