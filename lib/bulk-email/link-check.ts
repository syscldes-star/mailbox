// lib/bulk-email/link-check.ts
//
// Server-side broken-link check for the pre-send checklist. Because the
// server fetches URLs a user typed, every hop is guarded against SSRF:
// only http(s) on the standard ports, and the host must resolve to a
// public address (no localhost, private ranges, link-local/metadata
// endpoints). Redirects are followed by hand so each hop is re-checked.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not an http(s) link");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("non-standard port");
  if (url.username || url.password) throw new Error("credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("points to a private or internal address");
  }
}

export interface LinkResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

async function checkOne(original: string): Promise<LinkResult> {
  let current: URL;
  try {
    current = new URL(original);
  } catch {
    return { url: original, ok: false, error: "not a valid URL" };
  }
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (link check)" } });
        res.body?.cancel().catch(() => {});
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        continue;
      }
      // Some sites refuse automated requests (403/405/429) but work in a
      // browser -- report them as reachable rather than broken.
      const ok = res.status < 400 || [401, 403, 405, 429].includes(res.status);
      return { url: original, ok, status: res.status };
    }
    return { url: original, ok: false, error: "too many redirects" };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "AbortError" ? "timed out" : err.message) : String(err);
    return { url: original, ok: false, error: msg };
  }
}

export async function checkLinks(urls: string[]): Promise<LinkResult[]> {
  const unique = [...new Set(urls)];
  const results: LinkResult[] = [];
  for (let i = 0; i < unique.length; i += 5) {
    results.push(...(await Promise.all(unique.slice(i, i + 5).map(checkOne))));
  }
  return results;
}
