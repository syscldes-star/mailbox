"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, KeyRound, Link2, RefreshCw, XCircle } from "lucide-react";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api/client";

type CrmLink = { baseUrl: string; keyHint: string; status: "ok" | "failed"; lastCheckedAt: string | null; lastError: string; crmWorkspace: string; signupLeads: boolean; offForms: string[]; engagementNotes: boolean } | null;
type Form = { id: string; name: string; active: boolean; signups: number };
type Event = { id: string; kind: "signup" | "open" | "click"; email: string; detail: string; status: string; result: string; attempts: number; at: string };
type Key = { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

const button = "inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60";
const ghost = "inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-indigo-300 disabled:opacity-60";
const input = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const card = "rounded-xl border border-slate-200 bg-white p-5";
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");
const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
const KIND: Record<Event["kind"], string> = { signup: "Signup", open: "Opened", click: "Clicked" };

/** Integrations: link the CRM (signups become leads, opens and clicks go
 * in the lead's history, CRM leads become a contact list), and keys for
 * other apps to read this panel. The workspace owner and admins. */
export default function IntegrationsPage() {
  const [link, setLink] = useState<CrmLink | undefined>(undefined);
  const [forms, setForms] = useState<Form[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [crmKey, setCrmKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [imp, setImp] = useState({ listName: "", stage: "", tag: "", source: "", status: "" });
  const [keyName, setKeyName] = useState("CRM");
  const [newKey, setNewKey] = useState("");

  const load = useCallback(() => {
    apiGet<{ link: CrmLink; forms: Form[] }>("/api/integrations/crm")
      .then((r) => {
        setLink(r.link);
        setForms(r.forms);
        if (r.link) setBaseUrl(r.link.baseUrl);
      })
      .catch((e) => setError(message(e)));
    apiGet<Event[]>("/api/integrations/crm/events").then(setEvents).catch(() => undefined);
    apiGet<Key[]>("/api/integrations/keys").then(setKeys).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ ok: false, text: message(e) });
    }
    setBusy("");
  }

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    void run("connect", async () => {
      const r = await apiPut<{ test: { ok: boolean; error: string } }>("/api/integrations/crm", { baseUrl, key: crmKey });
      setNotice({ ok: r.test.ok, text: r.test.ok ? "The CRM is connected." : r.test.error });
      setCrmKey("");
      setEditing(false);
      load();
    });
  };

  const patch = (body: Record<string, unknown>) =>
    run("patch", async () => {
      const r = await apiPatch<{ link: CrmLink }>("/api/integrations/crm", body);
      setLink(r.link);
    });

  if (error) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  const showForm = !link || editing;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        <p className="mt-1 text-sm text-slate-500">Connect our other apps: subscribers can become CRM leads, and the CRM sees who opened and clicked your emails.</p>
      </div>
      {notice && <p className={`rounded-md px-3 py-2 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{notice.text}</p>}

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Link2 size={18} /> CRM
            </h2>
            <p className="text-sm text-slate-500">Your subscribers and email engagement, in the CRM.</p>
          </div>
          {link && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${link.status === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {link.status === "ok" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {link.status === "ok" ? "Connected" : "Not connected"}
            </span>
          )}
        </div>

        {link === undefined ? (
          <p className="mt-4 text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            {link && !editing && (
              <div className="mt-4 space-y-1 text-sm">
                <p className="text-slate-700">
                  <span className="font-medium">{link.crmWorkspace || "CRM"}</span> at <code className="text-xs">{link.baseUrl}</code> · key …{link.keyHint}
                </p>
                <p className={link.lastError ? "text-red-600" : "text-slate-400"}>{link.lastError || `Checked ${when(link.lastCheckedAt)}`}</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button type="button" onClick={() => run("check", async () => { const r = await apiPost<{ ok: boolean; error: string }>("/api/integrations/crm/test"); setNotice({ ok: r.ok, text: r.ok ? "The CRM is connected." : r.error }); load(); })} disabled={busy === "check"} className={ghost}>
                    <RefreshCw size={14} /> Check again
                  </button>
                  <button type="button" onClick={() => setEditing(true)} className={ghost}>
                    Change key or address
                  </button>
                  <button
                    type="button"
                    onClick={() => window.confirm("Unlink the CRM? Signups and engagement stop going there.") && run("unlink", async () => { await apiDelete("/api/integrations/crm"); setLink(null); setBaseUrl(""); load(); })}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Unlink
                  </button>
                </div>

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <label className="flex items-start gap-2 text-slate-700">
                    <input type="checkbox" checked={link.signupLeads} onChange={(e) => patch({ signupLeads: e.target.checked })} className="mt-1" />
                    <span>
                      <span className="font-medium">New subscribers become leads.</span> When someone confirms a signup form, they&apos;re added to the CRM (source “Email signup – &lt;form&gt;”). If they&apos;re already a lead, it&apos;s noted on their lead.
                    </span>
                  </label>
                  {link.signupLeads && forms.length > 0 && (
                    <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                      {forms.map((f) => (
                        <label key={f.id} className="flex items-center gap-1.5 text-slate-600">
                          <input type="checkbox" checked={!link.offForms.includes(f.id)} onChange={(e) => patch({ offForms: e.target.checked ? link.offForms.filter((x) => x !== f.id) : [...link.offForms, f.id] })} />
                          {f.name}
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="flex items-start gap-2 text-slate-700">
                    <input type="checkbox" checked={link.engagementNotes} onChange={(e) => patch({ engagementNotes: e.target.checked })} className="mt-1" />
                    <span>
                      <span className="font-medium">Opens and clicks go in the lead&apos;s history.</span> The first time a lead opens a bulk email, and the first time they click a link in it.
                    </span>
                  </label>
                </div>
              </div>
            )}
            {showForm && (
              <form onSubmit={connect} className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">CRM address</span>
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://crm.example.com" className={input} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">CRM API key</span>
                  <input value={crmKey} onChange={(e) => setCrmKey(e.target.value)} type="password" autoComplete="off" placeholder="crmk_…" className={input} />
                </label>
                <p className="text-xs text-slate-500 sm:col-span-2">In the CRM: Settings → Sales Configuration → API &amp; Integrations → New API key, with “Read &amp; write” access. The key is kept encrypted.</p>
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" disabled={busy === "connect" || !baseUrl.trim() || !crmKey.trim()} className={button}>
                    {busy === "connect" ? "Checking…" : "Connect"}
                  </button>
                  {link && (
                    <button type="button" onClick={() => setEditing(false)} className={ghost}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </section>

      {link && (
        <section className={card}>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Download size={18} /> Email your CRM leads
          </h2>
          <p className="text-sm text-slate-500">Make a contact list from CRM leads with an email (up to 5,000), then send it a bulk email. Each contact gets their mobile, company, city, stage and source as columns.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("import", async () => {
                const r = await apiPost<{ contacts: number; leads: number; withoutEmail: number }>("/api/integrations/crm/import", imp);
                setNotice({ ok: true, text: `List “${imp.listName}” made with ${r.contacts} contacts${r.withoutEmail ? ` (${r.withoutEmail} leads had no email or were repeats)` : ""}. Find it in Email Marketing → Lists.` });
                setImp({ ...imp, listName: "" });
              });
            }}
            className="mt-4 grid gap-3 sm:grid-cols-3"
          >
            <label className="space-y-1 text-sm sm:col-span-3">
              <span className="font-medium text-slate-700">New list name</span>
              <input value={imp.listName} onChange={(e) => setImp({ ...imp, listName: e.target.value })} placeholder="e.g. Qualified leads – Nov" className={input} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Stage (optional)</span>
              <input value={imp.stage} onChange={(e) => setImp({ ...imp, stage: e.target.value })} placeholder="e.g. Qualified, or Raw" className={input} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Tag (optional)</span>
              <input value={imp.tag} onChange={(e) => setImp({ ...imp, tag: e.target.value })} placeholder="e.g. VIP" className={input} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Source (optional)</span>
              <input value={imp.source} onChange={(e) => setImp({ ...imp, source: e.target.value })} placeholder="e.g. Website" className={input} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Status</span>
              <select value={imp.status} onChange={(e) => setImp({ ...imp, status: e.target.value })} className={input}>
                <option value="">Any</option>
                <option value="lead">Lead</option>
                <option value="prospect">Prospect</option>
                <option value="customer">Customer</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="flex items-end sm:col-span-2">
              <button type="submit" disabled={busy === "import" || !imp.listName.trim() || link.status !== "ok"} className={button}>
                {busy === "import" ? "Making the list…" : "Make list from CRM"}
              </button>
            </div>
          </form>
        </section>
      )}

      {link && events.length > 0 && (
        <section className={card}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recently sent to the CRM</h2>
            {events.some((e) => e.status === "pending") && (
              <button type="button" onClick={() => run("retry", async () => { await apiPost("/api/integrations/crm/retry"); load(); })} disabled={busy === "retry"} className={ghost}>
                Send waiting now
              </button>
            )}
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="text-xs text-slate-400">{when(e.at)}</span>
                <span className="font-medium text-slate-700">{KIND[e.kind]}</span>
                <span className="text-slate-700">{e.email}</span>
                <span className="min-w-0 flex-1 truncate text-slate-500">{e.detail}</span>
                <span className={`text-xs ${e.status === "done" ? "text-emerald-700" : e.status === "pending" ? "text-amber-700" : e.status === "failed" ? "text-red-600" : "text-slate-400"}`}>{e.result || (e.status === "pending" ? "Will try again" : e.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <KeyRound size={18} /> API keys for our other apps
        </h2>
        <p className="text-sm text-slate-500">Give a key to another app (e.g. the CRM&apos;s Connected apps → Email) so it can show the emails each lead got, opened and clicked.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("key", async () => {
              const r = await apiPost<{ key: string }>("/api/integrations/keys", { name: keyName });
              setNewKey(r.key);
              load();
            });
          }}
          className="mt-4 flex flex-wrap items-end gap-2"
        >
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Name</span>
            <input value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={60} className={input} />
          </label>
          <button type="submit" disabled={!keyName.trim()} className={button}>
            New key
          </button>
        </form>
        {newKey && (
          <div className="mt-3 rounded-md bg-slate-900 p-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-xs text-slate-100" data-testid="email-key">
                {newKey}
              </code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(newKey)} className="text-slate-300 hover:text-white" aria-label="Copy">
                <Copy size={15} />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-300">Copy it now: it won&apos;t be shown again.</p>
          </div>
        )}
        <ul className="mt-4 divide-y divide-slate-100">
          {keys.map((k) => (
            <li key={k.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${k.revoked ? "opacity-50" : ""}`}>
              <span className="flex-1">
                <span className="font-medium text-slate-900">{k.name}</span> <span className="text-xs text-slate-500">emlk_…{k.hint} · last used {when(k.lastUsedAt)}</span>
                {k.revoked && <span className="ml-2 text-xs text-red-600">Turned off</span>}
              </span>
              {!k.revoked && (
                <button type="button" onClick={() => window.confirm(`Turn off the key “${k.name}”?`) && run("revoke", async () => { await apiDelete(`/api/integrations/keys/${k.id}`); load(); })} className="text-sm text-red-600 hover:underline">
                  Turn off
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
