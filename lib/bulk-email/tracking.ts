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
