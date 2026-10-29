// lib/email-provisioning/dns-records.ts
//
// The DNS records a domain needs, each checked live. Manual-DNS customers
// copy these into their DNS provider; hosts are shown relative to the
// domain ("@" = the domain itself), which is what most providers expect.

import { hasCname, hasDmarc, hasMx, hasTxt, MAIL_SERVER_HOSTNAME, OWNERSHIP_HOST, ownershipValue, spfRecord } from "./dns-check";
import type { ProvisioningState } from "./types";

export interface DnsRecordRow {
  purpose: string;
  type: "TXT" | "MX" | "CNAME";
  host: string;
  value: string;
  priority?: number;
  required: boolean;
  /** true = live in DNS; null = couldn't check right now. */
  found: boolean | null;
  note?: string;
}

const relative = (name: string, domain: string) => (name === domain ? "@" : name.replace(new RegExp(`\\.${domain.replace(/\./g, "\\.")}$`), ""));

async function safe(check: () => Promise<boolean>): Promise<boolean | null> {
  try {
    return await check();
  } catch {
    return null;
  }
}

export async function dnsRecordsFor(state: ProvisioningState): Promise<DnsRecordRow[]> {
  const d = state.domain;
  const rows: Promise<DnsRecordRow>[] = [];

  if (state.dnsMode === "manual" && state.verificationToken) {
    const value = ownershipValue(state.verificationToken);
    rows.push(
      safe(() => hasTxt(`${OWNERSHIP_HOST}.${d}`, value)).then((found) => ({
        purpose: "Proves you own the domain",
        type: "TXT",
        host: OWNERSHIP_HOST,
        value,
        required: true,
        found,
      }))
    );
  }
  rows.push(
    safe(() => hasMx(d, MAIL_SERVER_HOSTNAME)).then((found) => ({
      purpose: "Delivers incoming mail to your webmail",
      type: "MX",
      host: "@",
      value: MAIL_SERVER_HOSTNAME,
      priority: 10,
      required: true,
      found,
      note: "Remove other MX records for this domain, or mail may go to your old provider.",
    }))
  );
  if (state.oracleDkimCnameName && state.oracleDkimCnameValue) {
    rows.push(
      safe(() => hasCname(state.oracleDkimCnameName!, state.oracleDkimCnameValue!)).then((found) => ({
        purpose: "DKIM -- signs your emails so they aren't marked as spam",
        type: "CNAME",
        host: relative(state.oracleDkimCnameName!, d),
        value: state.oracleDkimCnameValue!,
        required: true,
        found,
      }))
    );
  }
  rows.push(
    safe(async () => !!(await spfRecord(d))?.match(/\bmx\b/)).then((found) => ({
      purpose: "SPF -- lists who may send email for the domain",
      type: "TXT",
      host: "@",
      value: "v=spf1 mx ~all",
      required: false,
      found,
      note: "Only one SPF record is allowed -- if you already have one, add \"mx\" to it instead.",
    }))
  );
  rows.push(
    safe(() => hasDmarc(d)).then((found) => ({
      purpose: "DMARC -- tells inboxes how to treat failed checks",
      type: "TXT",
      host: "_dmarc",
      value: `v=DMARC1; p=none; rua=mailto:admin@${d}`,
      required: false,
      found,
    }))
  );
  if (state.returnPathCnameName && state.returnPathCnameValue) {
    rows.push(
      safe(() => hasCname(state.returnPathCnameName!, state.returnPathCnameValue!)).then((found) => ({
        purpose: "Return path -- Gmail shows \"mailed-by\" your domain",
        type: "CNAME",
        host: relative(state.returnPathCnameName!, d),
        value: state.returnPathCnameValue!,
        required: true,
        found,
      }))
    );
  }
  return Promise.all(rows);
}
