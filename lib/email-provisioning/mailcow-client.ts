// lib/email-provisioning/mailcow-client.ts
//
// Thin wrapper around the Mailcow REST API — this is the same API key
// type you already tested manually (System -> Access -> API, Read-Write).
//
// Required env vars:
//   MAILCOW_API_BASE_URL   e.g. "https://mail-test.vidyarishi.in/api/v1"
//   MAILCOW_API_KEY

const BASE_URL = process.env.MAILCOW_API_BASE_URL!;
const API_KEY = process.env.MAILCOW_API_KEY!;

async function mailcowFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  // Mailcow returns an array of {type: "success"|"error", msg: [...]}
  const failed = Array.isArray(data) && data.some((d: any) => d.type === "error");
  if (!res.ok || failed) {
    throw new Error(`Mailcow API error on ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Add a domain to Mailcow (idempotent-ish — checks first). */
export async function mailcowAddDomain(domain: string) {
  const existing = await mailcowFetch(`/get/domain/${domain}`);
  if (existing && !Array.isArray(existing) === false && (existing as any).domain_name) {
    return existing; // already exists
  }
  return mailcowFetch("/add/domain", {
    method: "POST",
    body: JSON.stringify({
      domain,
      description: `Auto-provisioned for ${domain}`,
      aliases: 400,
      mailboxes: 10,
      defquota: 3072,
      maxquota: 10240,
      quota: 10240,
      active: "1",
    }),
  });
}

/** List mailboxes for a domain -- powers the /email/mailboxes page. */
export async function mailcowListMailboxes(domain: string) {
  const data = await mailcowFetch(`/get/mailbox/all/${domain}`);
  return Array.isArray(data) ? data : [];
}

/** Create the default mailbox for a newly provisioned domain. */
export async function mailcowAddMailbox(params: {
  domain: string;
  localPart: string;
  password: string;
  fullName: string;
}) {
  return mailcowFetch("/add/mailbox", {
    method: "POST",
    body: JSON.stringify({
      local_part: params.localPart,
      domain: params.domain,
      name: params.fullName,
      password: params.password,
      password2: params.password,
      quota: "3072",
      active: "1",
    }),
  });
}

/** Update a mailbox's display name (Mailcow's own "Full name" field) --
 * lets the mailbox owner set this from our own portal instead of needing
 * Mailcow admin access, which platform customers don't have. */
export async function mailcowEditMailboxName(username: string, name: string) {
  return mailcowFetch("/edit/mailbox", {
    method: "POST",
    body: JSON.stringify({
      items: [username],
      attr: { name },
    }),
  });
}

/** Permanently deletes a mailbox -- lets an owner clean up a mailbox they
 * don't want (e.g. the auto-created default one) without needing Mailcow
 * admin access. */
export async function mailcowDeleteMailbox(username: string) {
  return mailcowFetch("/delete/mailbox", {
    method: "POST",
    body: JSON.stringify([username]),
  });
}
