// lib/bulk-email/tracking.ts
//
// Open tracking via a 1x1 pixel. Each recipient's pixel URL names the job
// and the recipient's position in it, plus a short HMAC so nobody can
// forge opens for other recipients by editing the URL.

import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set.");
  return secret;
}

function sign(jobId: string, index: number): string {
  return createHmac("sha256", getSecret()).update(`open:${jobId}:${index}`).digest("base64url").slice(0, 16);
}

export function openPixelUrl(publicBaseUrl: string, jobId: string, index: number): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/api/track/open/${jobId}-${index}-${sign(jobId, index)}.gif`;
}

/** Parses and verifies a pixel token ("<jobId>-<index>-<sig>.gif"). */
export function verifyOpenToken(token: string): { jobId: string; index: number } | null {
  const match = token.match(/^([a-f0-9]{24})-(\d{1,5})-([A-Za-z0-9_-]{16})(?:\.gif)?$/);
  if (!match) return null;
  const [, jobId, indexStr, sig] = match;
  const index = Number(indexStr);
  const expected = Buffer.from(sign(jobId, index));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { jobId, index };
}

/** Puts the pixel just before </body> when there is one, else at the end. */
export function withOpenPixel(html: string, pixelUrl: string): string {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${img}</body>`) : html + img;
}

// ---- Click tracking ----
//
// Each link is rewritten to /api/track/click/<jobId>-<index>-<sig>?u=<url>.
// The signature covers the destination URL too, so the route can never
// be used as an open redirect to somewhere the email didn't link to.

function signClick(jobId: string, index: number, url: string): string {
  return createHmac("sha256", getSecret()).update(`click:${jobId}:${index}:${url}`).digest("base64url").slice(0, 16);
}

export function clickTrackingUrl(publicBaseUrl: string, jobId: string, index: number, url: string): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return `${base}/api/track/click/${jobId}-${index}-${signClick(jobId, index, url)}?u=${encodeURIComponent(url)}`;
}

/** Verifies a click token against the destination it claims to lead to. */
export function verifyClickToken(token: string, url: string): { jobId: string; index: number } | null {
  const match = token.match(/^([a-f0-9]{24})-(\d{1,5})-([A-Za-z0-9_-]{16})$/);
  if (!match || !/^https?:\/\//i.test(url)) return null;
  const [, jobId, indexStr, sig] = match;
  const index = Number(indexStr);
  const expected = Buffer.from(signClick(jobId, index, url));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { jobId, index };
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Rewrites every http(s) <a href> in already-rendered HTML through
 * `wrap`, except links `skip` says to leave alone (the unsubscribe link). */
export function rewriteLinks(html: string, wrap: (url: string) => string, skip: (url: string) => boolean): string {
  return html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (whole, prefix: string, _quote: string, raw: string) => {
    const url = decodeHtmlAttr(raw.trim());
    if (!/^https?:\/\//i.test(url) || skip(url)) return whole;
    return `${prefix}"${encodeHtmlAttr(wrap(url))}"`;
  });
}

// ---- Campaign (UTM) tags ----

export interface UtmTags {
  source: string;
  medium: string;
  campaign: string;
}

/** Adds utm_source/medium/campaign to a link, keeping any utm_* the
 * link already sets (a hand-tagged link wins). Non-http links and URLs
 * that don't parse are returned unchanged. */
export function addUtmTags(url: string, utm: UtmTags): string {
  if (!/^https?:\/\//i.test(url) || /\{\{/.test(url)) return url;
  try {
    const u = new URL(url);
    const pairs: [string, string][] = [
      ["utm_source", utm.source],
      ["utm_medium", utm.medium],
      ["utm_campaign", utm.campaign],
    ];
    for (const [key, value] of pairs) {
      if (value && !u.searchParams.has(key)) u.searchParams.set(key, value);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Lower-case, dash-separated version of a subject, for utm_campaign. */
export function campaignSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
