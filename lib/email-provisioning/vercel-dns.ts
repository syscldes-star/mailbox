// lib/email-provisioning/vercel-dns.ts
//
// Publishes DNS records to Vercel for a customer's domain automatically —
// this replaces the manual "add CNAME in Vercel dashboard" step you did
// for vidyarishi.in.
//
// Required env vars:
//   VERCEL_API_TOKEN
//   VERCEL_TEAM_ID   (optional — only if the domain lives under a team)
//
// Docs: https://vercel.com/docs/rest-api/endpoints/dns

const VERCEL_API = "https://api.vercel.com";

export async function addCnameRecord(params: {
  domain: string; // the apex/root domain registered in Vercel, e.g. "customerdomain.com"
  name: string; // subdomain part only, e.g. "oci2026b._domainkey"
  value: string; // target, e.g. "oci2026b.customerdomain.com.dkim.bom1.oracleemaildelivery.com"
  ttl?: number;
}) {
  return createRecord(params.domain, {
    type: "CNAME",
    name: params.name,
    value: params.value,
    ttl: params.ttl ?? 60,
  });
}

/** MX record pointing the domain's mail at your Mailcow server. Without
 * this, external senders (Gmail, etc.) have no way to find your server --
 * confirmed the hard way when phdinfo.in could send mail out but never
 * receive anything in, because this was missing. */
export async function addMxRecord(params: {
  domain: string;
  mailServerHostname: string; // e.g. "email.vidyarishi.in"
  priority?: number;
  ttl?: number;
}) {
  return createRecord(params.domain, {
    type: "MX",
    name: "", // apex/root
    value: params.mailServerHostname,
    mxPriority: params.priority ?? 10,
    ttl: params.ttl ?? 60,
  });
}

/** SPF record authorizing this domain's own MX to send mail as it --
 * same value used for vidyarishi.in. */
export async function addSpfRecord(params: { domain: string; ttl?: number }) {
  return createRecord(params.domain, {
    type: "TXT",
    name: "",
    value: "v=spf1 mx ~all",
    ttl: params.ttl ?? 60,
  });
}

/** DMARC record -- p=none is a safe default (monitor, don't reject) for
 * a newly provisioned domain that hasn't built sending reputation yet. */
export async function addDmarcRecord(params: { domain: string; ttl?: number }) {
  return createRecord(params.domain, {
    type: "TXT",
    name: "_dmarc",
    value: `v=DMARC1; p=none; rua=mailto:admin@${params.domain}`,
    ttl: params.ttl ?? 60,
  });
}

async function createRecord(
  domain: string,
  record: { type: string; name: string; value: string; ttl: number; mxPriority?: number }
) {
  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const res = await fetch(`${VERCEL_API}/v2/domains/${domain}/records${teamQuery}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const body = await res.text();
    // Vercel returns a specific error when a record already exists --
    // treat that as success rather than failing a retry.
    if (res.status === 409 || body.includes("already exists")) {
      return { alreadyExists: true };
    }
    throw new Error(`Vercel DNS create failed for ${record.type} on ${domain} (${res.status}): ${body}`);
  }
  return res.json();
}
