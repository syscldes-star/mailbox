// lib/bulk-email/domain-health.ts
//
// Live DNS + Oracle check of a sending domain. Provisioning publishes
// these records once; this catches them being changed or removed later
// (e.g. someone edits the domain's DNS), which otherwise silently sends
// mail to spam.

import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import type { ProvisioningState } from "../email-provisioning/types";
import { getDkimLifecycleState } from "../email-provisioning/oracle-client";

export type HealthLevel = "ok" | "warning" | "error";

export interface HealthCheck {
  id: "dkim_dns" | "dkim_oracle" | "sender" | "dmarc" | "spf" | "mx";
  label: string;
  level: HealthLevel;
  detail: string;
}

const norm = (v: string) => v.trim().toLowerCase().replace(/\.$/, "");

/** A DNS answer: the records, "missing" when the name definitely has
 * none, or "failed" when the lookup itself didn't work (timeout,
 * unreachable resolver) -- which must not be reported as missing. */
type Lookup<T> = { records: T[] } | { missing: true } | { failed: string };

async function query<T>(fn: () => Promise<T[]>): Promise<Lookup<T>> {
  try {
    const records = await fn();
    return records.length ? { records } : { missing: true };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    return code === "ENODATA" || code === "ENOTFOUND" ? { missing: true } : { failed: code || String(err) };
  }
}

function couldNotCheck(id: HealthCheck["id"], label: string, code: string): HealthCheck {
  return { id, label, level: "warning", detail: `Couldn't look this up right now (${code}) -- try again in a minute.` };
}

export async function checkDomainHealth(state: ProvisioningState): Promise<HealthCheck[]> {
  const domain = state.domain;
  const checks: HealthCheck[] = [];
  const add = (c: HealthCheck) => checks.push(c);

  // DKIM record in DNS -- what lets mailbox providers verify the
  // signature on every email; without it mail is likely to go to spam.
  if (!state.oracleDkimCnameName || !state.oracleDkimCnameValue) {
    add({ id: "dkim_dns", label: "DKIM record", level: "error", detail: "No DKIM key was set up for this domain." });
  } else {
    const cname = await query(() => resolveCname(state.oracleDkimCnameName!));
    if ("failed" in cname) add(couldNotCheck("dkim_dns", "DKIM record", cname.failed));
    else if ("missing" in cname) {
      add({
        id: "dkim_dns",
        label: "DKIM record",
        level: "error",
        detail: `${state.oracleDkimCnameName} is missing from DNS -- emails can't be verified and will likely go to spam.`,
      });
    } else {
      const targets = cname.records.map(norm);
      add(
        targets.includes(norm(state.oracleDkimCnameValue))
          ? { id: "dkim_dns", label: "DKIM record", level: "ok", detail: "Published and pointing at Oracle." }
          : {
              id: "dkim_dns",
              label: "DKIM record",
              level: "error",
              detail: `${state.oracleDkimCnameName} points to ${targets.join(", ")} instead of ${state.oracleDkimCnameValue}.`,
            }
      );
    }
  }

  // Oracle's own view of the key.
  if (state.oracleDkimId) {
    try {
      const lifecycle = await getDkimLifecycleState(state.oracleDkimId);
      add(
        lifecycle === "ACTIVE"
          ? { id: "dkim_oracle", label: "DKIM signing", level: "ok", detail: "Oracle is signing emails for this domain." }
          : { id: "dkim_oracle", label: "DKIM signing", level: "error", detail: `Oracle reports the DKIM key as ${lifecycle ?? "unknown"}.` }
      );
    } catch (err) {
      add({
        id: "dkim_oracle",
        label: "DKIM signing",
        level: "warning",
        detail: `Couldn't ask Oracle about the DKIM key: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  add(
    state.steps.oracle_sender === "done"
      ? { id: "sender", label: "Approved sender", level: "ok", detail: `Any address @${domain} can send.` }
      : { id: "sender", label: "Approved sender", level: "error", detail: "Oracle hasn't approved this domain for sending yet." }
  );

  // DMARC tells providers what to do with mail that fails checks.
  const dmarcLookup = await query(async () => (await resolveTxt(`_dmarc.${domain}`)).map((c) => c.join("")));
  const dmarc = "records" in dmarcLookup ? dmarcLookup.records.filter((r) => /^v=DMARC1/i.test(r)) : [];
  if ("failed" in dmarcLookup) add(couldNotCheck("dmarc", "DMARC", dmarcLookup.failed));
  else if (dmarc.length === 0) {
    add({ id: "dmarc", label: "DMARC", level: "warning", detail: "No DMARC record -- Gmail and Yahoo expect one from bulk senders." });
  } else if (dmarc.length > 1) {
    add({ id: "dmarc", label: "DMARC", level: "error", detail: "More than one DMARC record -- providers ignore all of them." });
  } else {
    const policy = /;\s*p\s*=\s*(\w+)/i.exec(dmarc[0])?.[1]?.toLowerCase() ?? "none";
    add({
      id: "dmarc",
      label: "DMARC",
      level: "ok",
      detail: policy === "none" ? "Published (policy: none -- monitoring only)." : `Published (policy: ${policy}).`,
    });
  }

  const spfLookup = await query(async () => (await resolveTxt(domain)).map((c) => c.join("")));
  const spf = "records" in spfLookup ? spfLookup.records.filter((r) => /^v=spf1\b/i.test(r)) : [];
  if ("failed" in spfLookup) add(couldNotCheck("spf", "SPF", spfLookup.failed));
  else if (spf.length === 0) {
    add({ id: "spf", label: "SPF", level: "warning", detail: "No SPF record -- mail sent from your mailboxes is more likely to be flagged." });
  } else if (spf.length > 1) {
    add({ id: "spf", label: "SPF", level: "error", detail: "More than one SPF record -- that makes SPF invalid. Merge them into one." });
  } else {
    add({ id: "spf", label: "SPF", level: "ok", detail: spf[0] });
  }

  const mailHost = norm(process.env.MAILCOW_SERVER_HOSTNAME ?? "email.vidyarishi.in");
  const mxLookup = await query(() => resolveMx(domain));
  if ("failed" in mxLookup) add(couldNotCheck("mx", "MX (replies)", mxLookup.failed));
  else if ("missing" in mxLookup) {
    add({ id: "mx", label: "MX (replies)", level: "warning", detail: "No MX record -- replies to your emails will bounce." });
  } else {
    const mx = mxLookup.records.map((m) => norm(m.exchange));
    add(
      mx.includes(mailHost)
        ? { id: "mx", label: "MX (replies)", level: "ok", detail: `Replies are delivered to ${mailHost}.` }
        : {
            id: "mx",
            label: "MX (replies)",
            level: "warning",
            detail: `MX points to ${mx.join(", ")}, not ${mailHost} -- replies won't reach your mailboxes here.`,
          }
    );
  }

  return checks;
}
