// lib/email-provisioning/dns-check.ts
//
// Checks whether a customer has published a DNS record yet (manual DNS
// mode). Asks public resolvers directly rather than the server's own
// cache, so a record shows up as soon as it's live.

import { Resolver } from "node:dns/promises";

/** Where mail for provisioned domains is delivered. */
export const MAIL_SERVER_HOSTNAME = process.env.MAILCOW_SERVER_HOSTNAME ?? "email.vidyarishi.in";
/** Ownership record host, relative to the domain (_vidyarishi.example.com). */
export const OWNERSHIP_HOST = "_vidyarishi";
export const ownershipValue = (token: string) => `vidyarishi-verify=${token}`;

function publicResolver() {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return r;
}

const norm = (v: string) => v.trim().toLowerCase().replace(/\.$/, "");
const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "ESERVFAIL", "ENONAME", "ENOTIMP", "EREFUSED"]);

/** Asks public resolvers; if they can't be reached (some servers block
 * outbound DNS), falls back to the server's own resolver. Missing records
 * are "not found" (empty), not errors. */
async function lookup<T>(fn: (r: Resolver) => Promise<T[]>): Promise<T[]> {
  for (const r of [publicResolver(), new Resolver({ timeout: 4000, tries: 2 })]) {
    try {
      return await fn(r);
    } catch (err) {
      if (NOT_FOUND.has((err as { code?: string }).code ?? "")) return [];
      // Timeout / connection refused: try the next resolver.
    }
  }
  throw new Error("DNS lookup failed: no resolver could be reached.");
}

export async function hasTxt(name: string, expected: string): Promise<boolean> {
  const records = await lookup((r) => r.resolveTxt(name));
  return records.some((chunks) => chunks.join("").trim() === expected);
}

export async function hasCname(name: string, target: string): Promise<boolean> {
  const records = await lookup((r) => r.resolveCname(name));
  return records.some((r) => norm(r) === norm(target));
}

export async function hasMx(domain: string, host: string): Promise<boolean> {
  const records = await lookup((r) => r.resolveMx(domain));
  return records.some((r) => norm(r.exchange) === norm(host));
}

/** The apex SPF record, if any (there must only be one). */
export async function spfRecord(domain: string): Promise<string | null> {
  const records = await lookup((r) => r.resolveTxt(domain));
  return records.map((c) => c.join("")).find((t) => /^v=spf1\b/i.test(t.trim())) ?? null;
}

export async function hasDmarc(domain: string): Promise<boolean> {
  const records = await lookup((r) => r.resolveTxt(`_dmarc.${domain}`));
  return records.some((c) => /^v=DMARC1\b/i.test(c.join("").trim()));
}
