"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Upload, Users, Trash2, Download, Send, Pencil, Check, X, Search, ChevronLeft, Loader2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api/client";
import { recipientsToCsv } from "@/lib/bulk-email/recipients";
import { cardClass, downloadTextFile, formatDate, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

interface ListSummary {
  id: string;
  name: string;
  columns: string[];
  count: number;
  updatedAt: string;
}

interface Contact {
  email: string;
  name?: string;
  vars?: Record<string, string>;
}

interface FullList extends Omit<ListSummary, "count"> {
  contacts: Contact[];
}

export default function ListsTab({
  onUse,
  onOpenContact,
}: {
  onUse: (csv: string, notice: string) => void;
  onOpenContact: (email: string) => void;
}) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<FullList | null>(null);
  const [lookup, setLookup] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const r = await apiGet<{ lists: ListSummary[]; canManage: boolean }>("/api/email/lists");
      setLists(r.lists);
      setCanManage(r.canManage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load lists.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openList(id: string) {
    try {
      setOpen(await apiGet<FullList>(`/api/email/lists/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't open that list.");
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ count: number; invalid: number; duplicates: number }>("/api/email/lists", { name: newName, text: newText });
      setNotice(
        `Created "${newName}" with ${r.count.toLocaleString()} contacts` +
          (r.invalid || r.duplicates ? ` (${r.invalid} invalid and ${r.duplicates} duplicate lines skipped).` : ".")
      );
      setCreating(false);
      setNewName("");
      setNewText("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the list.");
    } finally {
      setBusy(false);
    }
  }

  if (open) {
    return (
      <ListDetail
        list={open}
        canManage={canManage}
        onBack={() => {
          setOpen(null);
          load();
        }}
        onChanged={() => openList(open.id)}
        onUse={onUse}
        onOpenContact={onOpenContact}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Save recipient lists once, then reuse them -- or a filtered segment -- from Compose.</p>
        {canManage && !creating && (
          <button onClick={() => setCreating(true)} className={primaryButton}>
            <Plus size={15} /> New list
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (lookup.trim()) onOpenContact(lookup.trim().toLowerCase());
        }}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
      >
        <Search size={16} className="text-slate-400" />
        <input
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          type="email"
          placeholder="Look up a contact by email address…"
          className="w-full text-sm outline-none placeholder:text-slate-400"
        />
        <button type="submit" disabled={!lookup.trim()} className={secondaryButton}>
          View
        </button>
      </form>

      {creating && (
        <div className={cardClass + " space-y-3"}>
          <div>
            <label className={labelClass}>List name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Newsletter subscribers" className={inputClass} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={labelClass + " mb-0"}>Contacts</label>
              <button onClick={() => fileInput.current?.click()} className={secondaryButton}>
                <Upload size={13} /> Upload CSV
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setNewText(await f.text());
                  e.target.value = "";
                }}
              />
            </div>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={6}
              placeholder={"Paste a CSV with a header row (email,name,city,...) or one address per line"}
              className={inputClass + " font-mono text-xs"}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={create} disabled={busy || !newName.trim() || !newText.trim()} className={primaryButton}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Create list
            </button>
            <button onClick={() => setCreating(false)} className="text-sm text-slate-500 hover:text-slate-900">
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!lists ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : lists.length === 0 ? (
        <div className={cardClass + " text-center"}>
          <Users size={22} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-slate-600">No saved lists yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {lists.map((l) => (
            <button key={l.id} onClick={() => openList(l.id)} className={cardClass + " text-left transition-shadow hover:shadow-md"}>
              <p className="font-serif text-base font-bold text-slate-900">{l.name}</p>
              <p className="mt-1 text-sm text-slate-700">{l.count.toLocaleString()} contacts</p>
              <p className="mt-1 truncate text-xs text-slate-400">Columns: {l.columns.join(", ")}</p>
              <p className="text-xs text-slate-400">Updated {formatDate(l.updatedAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ListDetail({
  list,
  canManage,
  onBack,
  onChanged,
  onUse,
  onOpenContact,
}: {
  list: FullList;
  canManage: boolean;
  onBack: () => void;
  onChanged: () => void;
  onUse: (csv: string, notice: string) => void;
  onOpenContact: (email: string) => void;
}) {
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list.contacts;
    return list.contacts.filter(
      (c) => c.email.includes(needle) || (c.name ?? "").toLowerCase().includes(needle) || Object.values(c.vars ?? {}).some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [q, list.contacts]);
  const extraColumns = list.columns.filter((c) => c !== "email" && c !== "name");

  async function update(body: Record<string, unknown>, success: (r: { added: number; updated: number; removed: number }) => string) {
    setError(null);
    try {
      const r = await apiPut<{ added: number; updated: number; removed: number }>(`/api/email/lists/${list.id}`, body);
      setNotice(success(r));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    }
  }

  async function remove() {
    try {
      await apiDelete(`/api/email/lists/${list.id}`);
      onBack();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
        <ChevronLeft size={15} /> All lists
      </button>

      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {renaming ? (
            <div className="flex items-center gap-1">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
              <button
                onClick={() => {
                  setRenaming(false);
                  update({ name }, () => "List renamed.");
                }}
                className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50"
              >
                <Check size={15} />
              </button>
              <button onClick={() => setRenaming(false)} className="rounded-lg p-1.5 text-slate-400">
                <X size={15} />
              </button>
            </div>
          ) : (
            <div>
              <p className="font-serif text-lg font-bold text-slate-900">
                {list.name}
                {canManage && (
                  <button onClick={() => setRenaming(true)} className="ml-2 align-middle text-slate-400 hover:text-slate-700" aria-label="Rename">
                    <Pencil size={13} />
                  </button>
                )}
              </p>
              <p className="text-xs text-slate-500">{list.contacts.length.toLocaleString()} contacts</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onUse(recipientsToCsv(list.contacts), `Loaded ${list.contacts.length.toLocaleString()} contacts from "${list.name}".`)} className={secondaryButton}>
              <Send size={13} /> Use in Compose
            </button>
            <button onClick={() => downloadTextFile(`${list.name}.csv`, recipientsToCsv(list.contacts))} className={secondaryButton}>
              <Download size={13} /> Export CSV
            </button>
            {canManage && (
              <button onClick={() => setAdding((v) => !v)} className={secondaryButton}>
                <Plus size={13} /> Add contacts
              </button>
            )}
            {canManage &&
              (confirmDelete ? (
                <span className="flex items-center gap-2 text-xs">
                  Delete list?
                  <button onClick={remove} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white">
                    Delete
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="text-slate-500">
                    Cancel
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className={secondaryButton + " text-red-600"}>
                  <Trash2 size={13} /> Delete list
                </button>
              ))}
          </div>
        </div>

        {adding && (
          <div className="mt-4 space-y-2">
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={4}
              placeholder="Paste more contacts (CSV with header, or one address per line). Existing addresses are updated, not duplicated."
              className={inputClass + " font-mono text-xs"}
            />
            <button
              onClick={() => {
                update({ addText }, (r) => `Added ${r.added}, updated ${r.updated}.`);
                setAddText("");
                setAdding(false);
              }}
              disabled={!addText.trim()}
              className={secondaryButton}
            >
              <Plus size={13} /> Add
            </button>
          </div>
        )}
      </div>

      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <Search size={16} className="text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts..." className="w-full text-sm outline-none placeholder:text-slate-400" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Name</th>
              {extraColumns.map((c) => (
                <th key={c} className="px-3 py-2.5">
                  {c}
                </th>
              ))}
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((c) => (
              <tr key={c.email} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">
                  <button onClick={() => onOpenContact(c.email)} className="hover:text-indigo-600 hover:underline">
                    {c.email}
                  </button>
                </td>
                <td className="px-3 py-2 text-slate-600">{c.name}</td>
                {extraColumns.map((col) => (
                  <td key={col} className="px-3 py-2 text-slate-600">
                    {c.vars?.[col]}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <button
                      onClick={() => update({ removeEmails: [c.email] }, () => `${c.email} removed from the list.`)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${c.email}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 200 && <p className="text-xs text-slate-400">Showing the first 200 of {filtered.length.toLocaleString()} -- search to narrow, or export CSV.</p>}
    </div>
  );
}
