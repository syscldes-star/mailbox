"use client";

// Email Marketing → Subscribers: everyone who joined through a signup
// form, across all forms and lists, newest first.

import { useEffect, useState } from "react";
import { Search, RefreshCw, Loader2, Download, UserPlus } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";
import { cardClass, csvEscape, downloadTextFile, formatDate, inputClass, secondaryButton } from "./ui";

type Status = "subscribed" | "unsubscribed" | "bounced" | "complained" | "manual" | "inactive";

interface Subscriber {
  email: string;
  name?: string;
  form?: string;
  list: string;
  subscribedAt?: string;
  status: Status;
}

const STATUS: Record<Status, { label: string; badge: string }> = {
  subscribed: { label: "Subscribed", badge: "bg-emerald-50 text-emerald-700" },
  unsubscribed: { label: "Unsubscribed", badge: "bg-slate-100 text-slate-600" },
  bounced: { label: "Bounced", badge: "bg-red-50 text-red-700" },
  complained: { label: "Spam complaint", badge: "bg-amber-50 text-amber-800" },
  manual: { label: "Do not email", badge: "bg-indigo-50 text-indigo-700" },
  inactive: { label: "Inactive", badge: "bg-violet-50 text-violet-700" },
};

export default function SubscribersTab({ onOpenContact }: { onOpenContact: (email: string) => void }) {
  const [data, setData] = useState<{ subscribers: Subscriber[]; total: number; limit: number } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(q = query) {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet(`/api/email/subscribers${q ? `?q=${encodeURIComponent(q)}` : ""}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load subscribers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function exportCsv() {
    if (!data) return;
    const lines = [
      "email,name,status,signup_form,list,subscribed_at",
      ...data.subscribers.map((s) =>
        [s.email, s.name ?? "", STATUS[s.status].label, s.form ?? "", s.list, s.subscribedAt ?? ""].map(csvEscape).join(",")
      ),
    ];
    downloadTextFile("subscribers.csv", lines.join("\n"));
  }

  const active = data?.subscribers.filter((s) => s.status === "subscribed").length ?? 0;

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or name" className={inputClass + " pl-8"} />
          </div>
          <button onClick={() => load()} disabled={loading} className={secondaryButton}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={exportCsv} disabled={!data || data.subscribers.length === 0} className={secondaryButton}>
            <Download size={13} /> Export CSV
          </button>
        </div>

        {data && (
          <p className="mt-3 text-xs text-slate-500">
            {data.total.toLocaleString()} signup{data.total === 1 ? "" : "s"}
            {query ? " matching" : ""} · {active.toLocaleString()} still subscribed
            {data.total > data.subscribers.length ? ` · showing the latest ${data.subscribers.length.toLocaleString()}` : ""}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!data && !error ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : data && data.subscribers.length === 0 ? (
          <div className="mt-6 text-center">
            <UserPlus size={22} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm text-slate-600">{query ? "No subscribers match." : "No signups yet."}</p>
            {!query && <p className="mt-1 text-xs text-slate-400">People appear here once they confirm a signup form.</p>}
          </div>
        ) : (
          data && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Signup form</th>
                    <th className="py-2 pr-3 font-medium">List</th>
                    <th className="py-2 pr-3 font-medium">Signed up</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.subscribers.map((s) => (
                    <tr key={`${s.list}:${s.email}`}>
                      <td className="py-2 pr-3">
                        <button onClick={() => onOpenContact(s.email)} className="text-slate-800 hover:text-indigo-600 hover:underline">
                          {s.email}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{s.name || "—"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.form || "—"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.list}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{formatDate(s.subscribedAt) || "—"}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[s.status].badge}`}>{STATUS[s.status].label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
