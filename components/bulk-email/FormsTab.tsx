"use client";

// Email Marketing → Signup forms: public forms that add confirmed
// (double opt-in) subscribers to a saved list.

import { useEffect, useState } from "react";
import { Plus, Copy, Check, ExternalLink, Pencil, Trash2, FormInput, Loader2, Users, RefreshCw } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api/client";
import { cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

interface SignupFormRow {
  id: string;
  name: string;
  listId: string;
  listName: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  heading: string;
  description?: string;
  buttonText: string;
  askName: boolean;
  redirectUrl?: string;
  active: boolean;
  signups: number;
}

interface Draft {
  name: string;
  listId: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName: string;
  heading: string;
  description: string;
  buttonText: string;
  askName: boolean;
  redirectUrl: string;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={secondaryButton}
    >
      {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />} {copied ? "Copied" : label}
    </button>
  );
}

interface Signup {
  email: string;
  name?: string;
  subscribedAt?: string;
}

/** Who confirmed through one form, newest first. */
function SignupsPanel({ formId, listName }: { formId: string; listName: string }) {
  const [data, setData] = useState<{ signups: Signup[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<{ signups: Signup[]; total: number }>(`/api/email/forms/${formId}/signups`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load signups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  return (
    <div className="mt-4 rounded-lg border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-xs font-medium text-slate-600">
          {data ? `${data.total.toLocaleString()} ${data.total === 1 ? "person" : "people"} signed up` : "Signups"} · added to{" "}
          <strong>{listName}</strong>
        </p>
        <button onClick={load} disabled={loading} className="text-slate-400 hover:text-slate-700" aria-label="Refresh signups">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {error && <p className="p-3 text-xs text-red-600">{error}</p>}
      {!data && !error && (
        <p className="flex items-center gap-2 p-3 text-xs text-slate-500">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </p>
      )}
      {data && data.signups.length === 0 && (
        <p className="p-3 text-xs text-slate-500">Nobody yet. People show up here once they click the link in the confirmation email.</p>
      )}
      {data && data.signups.length > 0 && (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Email</th>
                <th className="px-3 py-1.5 font-medium">Name</th>
                <th className="px-3 py-1.5 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.signups.map((s) => (
                <tr key={s.email}>
                  <td className="px-3 py-1.5 text-slate-800">{s.email}</td>
                  <td className="px-3 py-1.5 text-slate-600">{s.name || "—"}</td>
                  <td className="px-3 py-1.5 text-slate-500">{s.subscribedAt ? new Date(s.subscribedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total > data.signups.length && (
            <p className="p-3 text-xs text-slate-400">
              Showing the latest {data.signups.length.toLocaleString()}. The full list is in Lists → {listName}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function FormsTab({ senders }: { senders: { domain: string; defaultLocalPart: string }[] }) {
  const [forms, setForms] = useState<SignupFormRow[] | null>(null);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [embedFor, setEmbedFor] = useState<string | null>(null);
  const [signupsFor, setSignupsFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load() {
    try {
      const [f, l] = await Promise.all([
        apiGet<{ forms: SignupFormRow[]; baseUrl: string; canManage: boolean }>("/api/email/forms"),
        apiGet<{ lists: { id: string; name: string }[] }>("/api/email/lists"),
      ]);
      setForms(f.forms);
      setBaseUrl(f.baseUrl.replace(/\/+$/, ""));
      setCanManage(f.canManage);
      setLists(l.lists);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load signup forms.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setNotice(null);
    setEditing({
      id: null,
      draft: {
        name: "",
        listId: lists[0]?.id ?? "",
        fromDomain: senders[0]?.domain ?? "",
        fromLocalPart: senders[0]?.defaultLocalPart ?? "",
        fromName: "",
        heading: "Join our newsletter",
        description: "",
        buttonText: "Subscribe",
        askName: true,
        redirectUrl: "",
      },
    });
  }

  function startEdit(f: SignupFormRow) {
    setNotice(null);
    setEditing({
      id: f.id,
      draft: {
        name: f.name,
        listId: f.listId,
        fromDomain: f.fromDomain,
        fromLocalPart: f.fromLocalPart,
        fromName: f.fromName ?? "",
        heading: f.heading,
        description: f.description ?? "",
        buttonText: f.buttonText,
        askName: f.askName,
        redirectUrl: f.redirectUrl ?? "",
      },
    });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id) await apiPut(`/api/email/forms/${editing.id}`, editing.draft);
      else await apiPost("/api/email/forms", editing.draft);
      setNotice(editing.id ? "Form saved." : "Form created -- copy its link or embed code below.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the form.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(f: SignupFormRow) {
    try {
      await apiPut(`/api/email/forms/${f.id}`, { active: !f.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/api/email/forms/${id}`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  if (!forms) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          People sign up on a form, confirm by email, and are then added to a list -- proof they agreed to hear from you.
        </p>
        {canManage && !editing && (
          <button onClick={startNew} disabled={lists.length === 0 || senders.length === 0} className={primaryButton}>
            <Plus size={15} /> New form
          </button>
        )}
      </div>
      {canManage && lists.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Create a list first (Email Marketing → Lists) -- signups are added to a list.</p>
      )}

      {editing && (
        <div className={cardClass + " space-y-3"}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Form name (only you see this)</label>
              <input value={editing.draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Website footer" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Add signups to list</label>
              <select value={editing.draft.listId} onChange={(e) => set({ listId: e.target.value })} className={inputClass}>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Heading</label>
              <input value={editing.draft.heading} onChange={(e) => set({ heading: e.target.value })} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Description (optional)</label>
              <input
                value={editing.draft.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Monthly news and offers. No spam."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Button text</label>
              <input value={editing.draft.buttonText} onChange={(e) => set({ buttonText: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Thank-you page after confirming (optional)</label>
              <input
                value={editing.draft.redirectUrl}
                onChange={(e) => set({ redirectUrl: e.target.value })}
                placeholder="https://yoursite.com/thanks"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Confirmation email from</label>
              <div className="flex items-center gap-1">
                <input value={editing.draft.fromLocalPart} onChange={(e) => set({ fromLocalPart: e.target.value })} className={inputClass} />
                <span className="text-sm text-slate-400">@</span>
                <select value={editing.draft.fromDomain} onChange={(e) => set({ fromDomain: e.target.value })} className={inputClass}>
                  {senders.map((s) => (
                    <option key={s.domain} value={s.domain}>
                      {s.domain}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>Sender name (optional)</label>
              <input value={editing.draft.fromName} onChange={(e) => set({ fromName: e.target.value })} className={inputClass} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={editing.draft.askName} onChange={(e) => set({ askName: e.target.checked })} className="accent-indigo-600" />
            Ask for their name too
          </label>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className={primaryButton}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {editing.id ? "Save form" : "Create form"}
            </button>
            <button onClick={() => setEditing(null)} className="text-sm text-slate-500 hover:text-slate-900">
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {forms.length === 0 && !editing ? (
        <div className={cardClass + " text-center"}>
          <FormInput size={22} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-slate-600">No signup forms yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((f) => {
            const url = `${baseUrl}/api/subscribe/${f.id}`;
            const iframe = `<iframe src="${url}" width="100%" height="420" style="border:0;max-width:460px" title="${f.heading.replace(/"/g, "&quot;")}"></iframe>`;
            const htmlForm =
              `<form method="post" action="${url}">\n` +
              (f.askName ? `  <input name="name" type="text" placeholder="Name">\n` : "") +
              `  <input name="email" type="email" placeholder="Email" required>\n` +
              `  <input name="hp_x7" type="text" style="display:none" tabindex="-1" autocomplete="off">\n` +
              `  <button type="submit">${f.buttonText}</button>\n</form>`;
            return (
              <div key={f.id} className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-base font-bold text-slate-900">
                      {f.name}
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 align-middle font-sans text-xs font-medium ${f.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {f.active ? "Live" : "Off"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Adds to <strong>{f.listName}</strong> · {f.signups.toLocaleString()} confirmed signup{f.signups === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={url} target="_blank" rel="noreferrer" className={secondaryButton}>
                      <ExternalLink size={13} /> Open form
                    </a>
                    <button onClick={() => setSignupsFor(signupsFor === f.id ? null : f.id)} className={secondaryButton}>
                      <Users size={13} /> {signupsFor === f.id ? "Hide signups" : "View signups"}
                    </button>
                    <CopyButton text={url} label="Copy link" />
                    <button onClick={() => setEmbedFor(embedFor === f.id ? null : f.id)} className={secondaryButton}>
                      {embedFor === f.id ? "Hide embed code" : "Embed code"}
                    </button>
                    {canManage && (
                      <>
                        <button onClick={() => toggleActive(f)} className={secondaryButton}>
                          {f.active ? "Turn off" : "Turn on"}
                        </button>
                        <button onClick={() => startEdit(f)} className={secondaryButton} aria-label="Edit form">
                          <Pencil size={13} />
                        </button>
                        {confirmDelete === f.id ? (
                          <span className="flex items-center gap-2 text-xs">
                            Delete?
                            <button onClick={() => remove(f.id)} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white">
                              Delete
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="text-slate-500">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmDelete(f.id)} className={secondaryButton + " text-red-600"} aria-label="Delete form">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {signupsFor === f.id && <SignupsPanel formId={f.id} listName={f.listName} />}
                {embedFor === f.id && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600">Embed the hosted form (paste into your website)</p>
                        <CopyButton text={iframe} label="Copy" />
                      </div>
                      <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{iframe}</pre>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-600">Or use your own HTML form (style it however you like)</p>
                        <CopyButton text={htmlForm} label="Copy" />
                      </div>
                      <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{htmlForm}</pre>
                      <p className="mt-1 text-xs text-slate-400">Keep the hidden “hp_x7” field -- it catches spam bots.</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
