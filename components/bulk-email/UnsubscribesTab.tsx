"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Trash2, Plus, RefreshCw, Loader2, Download } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api/client";
import { cardClass, csvEscape, downloadTextFile, formatDate, inputClass, secondaryButton } from "./ui";

type Reason = "unsubscribed" | "bounced" | "complained" | "manual";

interface Entry {
  id: string;
  email: string;
  reason: Reason;
  note?: string;
  createdAt: string;
}

interface ListResult {
  items: Entry[];
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<Reason, number>>;
  canManage: boolean;
}

const REASON_LABEL: Record<Reason, string> = {
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complained: "Spam complaint",
  manual: "Added by hand",
};

const REASON_BADGE: Record<Reason, string> = {
  unsubscribed: "bg-slate-100 text-slate-700",
  bounced: "bg-red-50 text-red-700",
  complained: "bg-amber-50 text-amber-800",
  manual: "bg-indigo-50 text-indigo-700",
};

export default function UnsubscribesTab() {
  const [data, setData] = useState<ListResult | null>(null);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState<"" | Reason>("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addText, setAddText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ q, reason, page: String(page) });
      setData(await apiGet<ListResult>(`/api/email/suppressions?${params}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the list.");
    }
  }, [q, reason, page]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing in the search box
    return () => clearTimeout(t);
  }, [load]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const add = () =>
    run("add", async () => {
      const r = await apiPost<{ added: number; alreadyListed: number; invalid: number }>("/api/email/suppressions", {
        emails: addText,
      });
      setAddText("");
      setShowAdd(false);
      return `Added ${r.added}${r.alreadyListed ? `, ${r.alreadyListed} already listed` : ""}${r.invalid ? `, ${r.invalid} invalid skipped` : ""}.`;
    });

  const remove = (email: string) =>
    run("remove:" + email, async () => {
      await apiDelete(`/api/email/suppressions?email=${encodeURIComponent(email)}`);
      return `${email} removed. Future sends will include it again.`;
    });

  const syncNow = () =>
    run("sync", async () => {
      const r = await apiPost<{ checked: number; recipientsMarked: number; suppressionsAdded: number }>(
        "/api/email/suppressions/sync"
      );
      return `Checked ${r.checked} Oracle entries: ${r.recipientsMarked} recipients marked, ${r.suppressionsAdded} added to the list.`;
    });

  async function exportCsv() {
    // Fetch every page for the current filter.
    const all: Entry[] = [];
    for (let p = 1; ; p++) {
      const params = new URLSearchParams({ q, reason, page: String(p) });
      const res = await apiGet<ListResult>(`/api/email/suppressions?${params}`);
      all.push(...res.items);
      if (all.length >= res.total || res.items.length === 0) break;
    }
    const lines = ["email,reason,note,added_at", ...all.map((e) => [e.email, e.reason, e.note ?? "", e.createdAt].map(csvEscape).join(","))];
    downloadTextFile("do-not-email.csv", lines.join("\n"));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const canManage = data?.canManage ?? false;

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Do-not-email list</h2>
            <p className="mt-1 text-xs text-slate-500">
              Every address here is skipped on future sends. Bounces and spam complaints are added automatically every 15
              minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <button onClick={syncNow} disabled={busy === "sync"} className={secondaryButton}>
                {busy === "sync" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check bounces now
              </button>
            )}
            <button onClick={exportCsv} className={secondaryButton}>
              <Download size={13} /> Export CSV
            </button>
            {canManage && (
              <button onClick={() => setShowAdd((v) => !v)} className={secondaryButton}>
                <Plus size={13} /> Add addresses
              </button>
            )}
          </div>
        </div>

        {data && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {(["", "unsubscribed", "bounced", "complained", "manual"] as const).map((r) => {
              const count = r ? data.counts[r] ?? 0 : Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0);
              return (
                <button
                  key={r || "all"}
                  onClick={() => {
                    setReason(r);
                    setPage(1);
                  }}
                  className={`rounded-full px-3 py-1 ${reason === r ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {r ? REASON_LABEL[r] : "All"} · {count}
                </button>
              );
            })}
          </div>
        )}

        {showAdd && (
          <div className="mt-4 space-y-2">
            <textarea
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              rows={4}
              placeholder="Paste addresses -- one per line, or separated by commas. You can also paste a whole CSV column."
              className={inputClass + " font-mono text-xs"}
            />
            <button onClick={add} disabled={!addText.trim() || busy === "add"} className={secondaryButton}>
              {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add to list
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <Search size={16} className="text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search addresses..."
          className="w-full text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th className="px-3 py-3">Email</th>
              <th className="px-3 py-3">Reason</th>
              <th className="px-3 py-3">Added</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : data.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  Nobody on the list{q || reason ? " matches" : " yet"}.
                </td>
              </tr>
            ) : (
              data.items.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="px-3 py-2.5 font-medium text-slate-800">
                    {e.email}
                    {e.note && <span className="ml-2 text-xs font-normal text-slate-400">{e.note}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${REASON_BADGE[e.reason]}`}>
                      {REASON_LABEL[e.reason]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{formatDate(e.createdAt)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {canManage && (
                      <button
                        onClick={() => remove(e.email)}
                        disabled={busy === "remove:" + e.email}
                        title={
                          e.reason === "complained"
                            ? "This person reported your email as spam -- only remove if they asked to be re-added."
                            : "Remove from list"
                        }
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-slate-600">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={secondaryButton}>
            Previous
          </button>
          Page {page} of {totalPages}
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className={secondaryButton}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
