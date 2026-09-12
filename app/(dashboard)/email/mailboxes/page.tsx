"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Plus, Search, Pencil, Check, X, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api/client";
import type { ProvisioningState } from "@/lib/email-provisioning/types";

interface Mailbox {
  username: string;
  name: string;
  active: string | number;
  quota: number;
}

const WEBMAIL_BASE_URL = process.env.NEXT_PUBLIC_MAILCOW_WEBMAIL_URL ?? "https://email.vidyarishi.in";

function webmailLink(_email: string) {
  return `${WEBMAIL_BASE_URL}/user`;
}

export default function MailboxesPage() {
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const [localPart, setLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [deletingUsername, setDeletingUsername] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ProvisioningState[]>("/api/email/domains")
      .then((states) => {
        const readyDomains = states.filter((s) => s.steps.mailcow_domain === "done").map((s) => s.domain);
        setDomains(readyDomains);
        if (readyDomains.length > 0) setSelectedDomain(readyDomains[0]);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load domains."));
  }, []);

  useEffect(() => {
    if (!selectedDomain) return;
    setMailboxes(null);
    apiGet<Mailbox[]>(`/api/email/mailboxes?domain=${encodeURIComponent(selectedDomain)}`)
      .then(setMailboxes)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load mailboxes."));
  }, [selectedDomain]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiPost("/api/email/mailboxes", { domain: selectedDomain, localPart, password });
      setLocalPart("");
      setPassword("");
      setShowForm(false);
      const updated = await apiGet<Mailbox[]>(`/api/email/mailboxes?domain=${encodeURIComponent(selectedDomain)}`);
      setMailboxes(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create mailbox.");
    } finally {
      setCreating(false);
    }
  }

  function startEditingName(mb: Mailbox) {
    setEditingUsername(mb.username);
    setEditingName(mb.name ?? "");
  }

  async function saveName(username: string) {
    setSavingName(true);
    setError(null);
    try {
      await apiPatch("/api/email/mailboxes", { domain: selectedDomain, username, name: editingName });
      setMailboxes((prev) => (prev ? prev.map((mb) => (mb.username === username ? { ...mb, name: editingName } : mb)) : prev));
      setEditingUsername(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleDelete(username: string) {
    setDeletingUsername(username);
    setError(null);
    try {
      await apiDelete(
        `/api/email/mailboxes?domain=${encodeURIComponent(selectedDomain)}&username=${encodeURIComponent(username)}`
      );
      setMailboxes((prev) => (prev ? prev.filter((mb) => mb.username !== username) : prev));
      setConfirmingDelete(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete mailbox.");
    } finally {
      setDeletingUsername(null);
    }
  }

  const filtered = (mailboxes ?? []).filter((mb) => mb.username.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-slate-900">Mailboxes</h1>
          <p className="mt-1 text-sm text-slate-500">Manage mailboxes for your provisioned domains.</p>
        </div>
        {domains.length > 0 && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus size={16} />
            New Mailbox
          </button>
        )}
      </div>

      {domains.length === 0 ? (
        <p className="text-sm text-slate-400">No domains ready yet -- provision one on the Domains page first.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600">Domain</label>
              <select
                value={selectedDomain}
                onChange={(e) => setSelectedDomain(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <Search size={16} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mailboxes..."
                className="w-full text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {showForm && (
            <form
              onSubmit={handleCreate}
              className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="w-40">
                <label className="mb-1 block text-xs font-medium text-slate-500">New mailbox</label>
                <input
                  value={localPart}
                  onChange={(e) => setLocalPart(e.target.value)}
                  placeholder="sales"
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="w-48">
                <label className="mb-1 block text-xs font-medium text-slate-500">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create mailbox"}
              </button>
            </form>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {mailboxes === null ? (
              <p className="p-4 text-sm text-slate-400">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-slate-400">No mailboxes found.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Check Mail</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((mb) => (
                    <tr key={mb.username} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-700">{mb.username}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {editingUsername === mb.username ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && saveName(mb.username)}
                              className="w-32 rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <button
                              onClick={() => saveName(mb.username)}
                              disabled={savingName}
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setEditingUsername(null)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingName(mb)}
                            className="group flex items-center gap-1.5 text-left hover:text-slate-700"
                          >
                            <span>{mb.name || <span className="italic text-slate-300">Add a name</span>}</span>
                            <Pencil size={11} className="text-slate-300 opacity-0 group-hover:opacity-100" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            String(mb.active) === "1"
                              ? "rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
                              : "rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500"
                          }
                        >
                          {String(mb.active) === "1" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={webmailLink(mb.username)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          Check Mail
                          <ExternalLink size={12} />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {confirmingDelete === mb.username ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-slate-500">Delete this mailbox?</span>
                            <button
                              onClick={() => handleDelete(mb.username)}
                              disabled={deletingUsername === mb.username}
                              className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {deletingUsername === mb.username ? "Deleting…" : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmingDelete(null)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmingDelete(mb.username)}
                            className="rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                            title="Delete mailbox"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
