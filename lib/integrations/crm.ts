// lib/integrations/crm.ts
//
// The CRM link (Integrations → CRM): confirmed signup-form subscribers
// become CRM leads, and a lead's first open and first click of a bulk
// email go in its history. Each waits in a queue (CrmEvent) and is tried
// again if the CRM can't be reached: after 1 min, 5 min, 30 min, 2 h and
// 12 h (the scheduler's tick, or "Send waiting now"). Nothing here may
// break a signup, a tracking pixel or a link.
//
// The other way, importCrmLeads() makes a contact list from CRM leads.

import { connectToDatabase } from "../db/mongodb";
import { ContactList, MAX_CONTACTS_PER_LIST } from "../models/ContactList";
import { BulkRecipient } from "../models/BulkRecipient";
import { BulkEmailJob } from "../models/BulkEmailJob";
import { CrmEvent, CrmLink, type ICrmEvent, type ICrmLink } from "./models";
import { decryptSecret } from "./secret";

const RETRY_MINUTES = [1, 5, 30, 120, 720];
const TIMEOUT_MS = 6000;

/** The CRM's address without a trailing slash, or what's wrong with it. */
export function cleanCrmUrl(raw: string): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: "Enter the CRM's full address, e.g. https://crm.example.com" };
  }
  const local = ["localhost", "127.0.0.1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return { error: "Use an https:// address." };
  return { url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}

function crmFetch(link: Pick<ICrmLink, "baseUrl" | "keyEnc">, path: string, init: RequestInit = {}) {
  return fetch(`${link.baseUrl}/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${decryptSecret(link.keyEnc)}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual",
    cache: "no-store",
  });
}

/** Checks the link with the CRM's GET /api/v1/me, and notes the result. */
export async function testCrm(link: ICrmLink): Promise<{ ok: boolean; error: string }> {
  let ok = false;
  let error = "";
  let crmWorkspace = link.crmWorkspace;
  try {
    const res = await crmFetch(link, "/me");
    const body = (await res.json().catch(() => null)) as { workspace?: { name?: string }; key?: { scope?: string }; error?: string } | null;
    if (res.ok && body?.key?.scope === "read") error = "This CRM key can only read: make a key with “Read & write” access in the CRM.";
    else if (res.ok) ok = true;
    else error = res.status === 401 || res.status === 403 ? `The CRM refused the key${body?.error ? `: ${body.error}` : "."}` : `The CRM answered HTTP ${res.status}.`;
    if (ok) crmWorkspace = body?.workspace?.name ?? "";
  } catch (e) {
    error = (e as Error).name === "TimeoutError" ? "The CRM didn't answer in 6 seconds." : `Couldn't reach the CRM: ${(e as Error).message}`.slice(0, 200);
  }
  await CrmLink.updateOne({ workspaceId: link.workspaceId }, { status: ok ? "ok" : "failed", lastCheckedAt: new Date(), lastError: error, crmWorkspace });
  return { ok, error };
}

/** Queues something for the CRM (if the workspace is linked and wants it)
 * and tries it straight away while the link works. Never throws. */
export async function queueForCrm(event: { workspaceId: string; kind: ICrmEvent["kind"]; email: string; name?: string; detail?: string; link?: string; formId?: string }) {
  try {
    const link = await CrmLink.findOne({ workspaceId: event.workspaceId }).lean();
    if (!link) return;
    if (event.kind === "signup" && (!link.signupLeads || (event.formId && link.offForms.includes(event.formId)))) return;
    if (event.kind !== "signup" && !link.engagementNotes) return;
    const doc = await CrmEvent.create({ workspaceId: event.workspaceId, kind: event.kind, email: event.email, name: event.name ?? "", detail: event.detail ?? "", link: event.link ?? "" });
    if (link.status === "ok") await sendEvent(doc.toObject() as ICrmEvent, link);
  } catch (e) {
    console.error("[crm] couldn't queue an event", e);
  }
}

/** A bulk email's recipient (by job and position), for open/click events. */
export async function queueEngagement(kind: "open" | "click", jobId: string, index: number, link = "") {
  try {
    const [recipient, job] = await Promise.all([BulkRecipient.findOne({ jobId, index }).select("workspaceId email name").lean(), BulkEmailJob.findById(jobId).select("subject").lean()]);
    if (!recipient) return;
    await queueForCrm({ workspaceId: recipient.workspaceId, kind, email: recipient.email, name: recipient.name, detail: job?.subject ?? "", link });
  } catch (e) {
    console.error("[crm] couldn't queue engagement", e);
  }
}

class CrmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function findLead(link: ICrmLink, email: string): Promise<{ id: string } | null> {
  const res = await crmFetch(link, `/leads?email=${encodeURIComponent(email)}&limit=1`);
  if (!res.ok) throw new CrmError(`The CRM answered HTTP ${res.status}.`, res.status);
  const body = (await res.json()) as { data?: { id: string }[] };
  return body.data?.[0] ?? null;
}

/** Writes one queued event into the CRM, and notes how it went. */
async function sendEvent(event: ICrmEvent, link?: ICrmLink | null) {
  link ??= await CrmLink.findOne({ workspaceId: event.workspaceId }).lean();
  if (!link) return CrmEvent.updateOne({ _id: event._id }, { status: "skipped", nextAt: null, result: "The CRM was unlinked." });
  let status: ICrmEvent["status"] = "done";
  let result = "";
  let leadId = "";
  try {
    if (event.kind === "signup") {
      const r = await crmFetch(link, "/leads", {
        method: "POST",
        body: JSON.stringify({ email: event.email, name: event.name, source: `Email signup – ${event.detail}`.slice(0, 80), message: `Subscribed with the “${event.detail}” signup form.`, onDuplicate: "note" }),
      });
      const body = (await r.json().catch(() => null)) as { data?: { id?: string }; duplicate?: boolean; error?: string } | null;
      if (!r.ok) throw new CrmError(body?.error ?? `The CRM answered HTTP ${r.status}.`, r.status);
      leadId = body?.data?.id ?? "";
      result = body?.duplicate ? "Already a lead: added as a note." : "New lead in the CRM.";
    } else {
      const lead = await findLead(link, event.email);
      if (!lead) {
        status = "skipped";
        result = "Not a lead in the CRM.";
      } else {
        leadId = lead.id;
        const text = event.kind === "open" ? `Opened the email “${event.detail}”.` : `Clicked a link in the email “${event.detail}”: ${event.link}`;
        const r = await crmFetch(link, `/leads/${lead.id}/notes`, { method: "POST", body: JSON.stringify({ type: "email", body: text }) });
        if (!r.ok) throw new CrmError(`The CRM answered HTTP ${r.status}.`, r.status);
        result = "Added to the lead's history.";
      }
    }
  } catch (e) {
    const code = e instanceof CrmError ? e.status : undefined;
    const attempts = event.attempts + 1;
    const wait = RETRY_MINUTES[attempts - 1];
    // A refused key or bad data won't get better by trying again.
    const final = !wait || (code !== undefined && code >= 400 && code < 500 && code !== 429);
    const message = (e as Error).name === "TimeoutError" ? "The CRM didn't answer in 6 seconds." : (e as Error).message.slice(0, 200);
    await CrmEvent.updateOne({ _id: event._id }, { status: final ? "failed" : "pending", attempts, nextAt: final ? null : new Date(Date.now() + wait * 60_000), result: message });
    if (code === 401 || code === 403) await CrmLink.updateOne({ workspaceId: event.workspaceId }, { status: "failed", lastError: message, lastCheckedAt: new Date() });
    return;
  }
  await CrmEvent.updateOne({ _id: event._id }, { status, attempts: event.attempts + 1, nextAt: null, result, leadId });
}

/** Tries again the events that are due (one workspace, or all). */
export async function runCrmQueue(workspaceId?: string, limit = 200): Promise<number> {
  await connectToDatabase();
  const due = await CrmEvent.find({ ...(workspaceId ? { workspaceId } : {}), status: "pending", nextAt: { $lte: new Date() } }).sort({ nextAt: 1 }).limit(limit).lean();
  let done = 0;
  for (const event of due) {
    // Claimed first, so two at once don't send it twice.
    const claimed = await CrmEvent.updateOne({ _id: event._id, status: "pending", nextAt: event.nextAt }, { nextAt: new Date(Date.now() + 2 * 60_000) });
    if (!claimed.modifiedCount) continue;
    await sendEvent(event as ICrmEvent);
    done++;
  }
  return done;
}

export type LeadFilter = { status?: string; stage?: string; tag?: string; source?: string; q?: string };

/** Makes a contact list from CRM leads (with an email, matching the
 * filter), up to 5,000. Each contact carries the lead's mobile, company,
 * city, stage and source as columns for merge tags and segments. */
export async function importCrmLeads(link: ICrmLink, opts: { workspaceId: string; createdBy: string; listName: string; filter: LeadFilter }) {
  const params = new URLSearchParams({ limit: "100" });
  for (const [k, v] of Object.entries(opts.filter)) if (v?.trim()) params.set(k, v.trim());
  const contacts = new Map<string, { email: string; name?: string; vars: Record<string, string> }>();
  let leads = 0;
  for (let page = 1; page <= 50; page++) {
    params.set("page", String(page));
    const res = await crmFetch(link, `/leads?${params}`);
    const body = (await res.json().catch(() => null)) as { data?: { name: string; email: string; phone: string; company: string; city: string; source: string; stage: { name: string } | null; status: string }[]; hasMore?: boolean; error?: string } | null;
    if (!res.ok) throw new CrmError(body?.error ?? `The CRM answered HTTP ${res.status}.`, res.status);
    for (const l of body?.data ?? []) {
      leads++;
      const email = l.email?.trim().toLowerCase();
      if (!email || contacts.has(email)) continue;
      contacts.set(email, { email, name: l.name || undefined, vars: { phone: l.phone ?? "", company: l.company ?? "", city: l.city ?? "", stage: l.stage?.name ?? (l.status === "lead" ? "Raw" : l.status), source: l.source ?? "" } });
    }
    if (!body?.hasMore) break;
  }
  const list = [...contacts.values()].slice(0, MAX_CONTACTS_PER_LIST);
  const doc = await ContactList.create({ workspaceId: opts.workspaceId, name: opts.listName, columns: ["email", "name", "phone", "company", "city", "stage", "source"], contacts: list, createdBy: opts.createdBy });
  return { listId: String(doc._id), leads, contacts: list.length, withoutEmail: leads - list.length };
}
