"use client";

// Email Marketing → Engagement: who reads your emails and who has gone
// quiet, with a one-click option to stop emailing inactive people
// (which protects your sender reputation with Gmail and others).

import { useEffect, useState } from "react";
import { Activity, Download, Loader2, Search, UserMinus } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import { cardClass, csvEscape, downloadTextFile, formatDate, inputClass, secondaryButton } from "./ui";

type Segment = "engaged" | "active" | "inactive" | "new";

interface Person {
  email: string;
  name?: string;
  received: number;
  opened: number;
  clicked: number;
  lastSentAt?: string;
  lastEngagedAt?: string;
  score: number;
  segment: Segment;
}

interface Result {
  days: number;
  minSends: number;
  summary: Record<Segment, number>;
  total: number;
  alreadyStopped: number;
  trackedSends: number;
  matching: number;
  people: Person[];
  canManage: boolean;
}

const SEGMENT: Record<Segment, { label: string; help: string; badge: string; tile: string }> = {
  engaged: { label: "Engaged", help: "Opened or clicked in the last 30 days", badge: "bg-emerald-50 text-emerald-700", tile: "border-emerald-300" },
  active: { label: "Active", help: "Opened or clicked, but not in the last 30 days", badge: "bg-sky-50 text-sky-700", tile: "border-sky-300" },
  inactive: { label: "Inactive", help: "Several emails, never opened or clicked", badge: "bg-red-50 text-red-700", tile: "border-red-300" },
  new: { label: "New", help: "Too few emails yet to judge", badge: "bg-slate-100 text-slate-600", tile: "border-slate-300" },
};

export default function EngagementTab({ onOpenContact }: { onOpenContact: (email: string) => void }) {
  const [days, setDays] = useState(90);
  const [minSends, setMinSends] = useState(3);
  const [segment, setSegment] = useState<Segment | "">("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), minSends: String(minSends) });
      if (segment) params.set("segment", segment);
      if (query) params.set("q", query);
      setData(await apiGet<Result>(`/api/email/engagement?${params}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load engagement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, minSends, segment, query]);

  async function stopInactive() {
    setStopping(true);
    setError(null);
    try {
      const res = await apiPost<{ stopped: number }>("/api/email/engagement", { action: "stop_inactive", days, minSends });
      setNotice(
        res.stopped
          ? `Stopped emailing ${res.stopped.toLocaleString()} inactive ${res.stopped === 1 ? "person" : "people"}. They're listed under Subscribers → Unsubscribed as “Inactive” if you want to undo it.`
          : "Nobody is inactive right now."
      );
      setConfirmStop(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the list.");
    } finally {
      setStopping(false);
    }
  }

  function exportCsv() {
    if (!data) return;
    const lines = [
      "email,name,segment,score,emails_received,opened,clicked,last_opened_or_clicked,last_sent",
      ...data.people.map((p) =>
        [p.email, p.name ?? "", SEGMENT[p.segment].label, p.score, p.received, p.opened, p.clicked, p.lastEngagedAt ?? "", p.lastSentAt ?? ""]
          .map((v) => csvEscape(String(v)))
          .join(",")
      ),
    ];
    downloadTextFile(`engagement-${segment || "everyone"}.csv`, lines.join("\n"));
  }

  const inactiveCount = data?.summary.inactive ?? 0;

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>Look at emails from the last</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            {[30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          <span>· inactive after</span>
          <select value={minSends} onChange={(e) => setMinSends(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
            {[2, 3, 4, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} unopened emails
              </option>
            ))}
          </select>
          {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Only sends with open tracking count. Opens are recorded only for emails sent from your live server (not localhost), and some
          mail apps block the tracking image -- so treat “inactive” as a strong hint, not proof.
        </p>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(SEGMENT) as Segment[]).map((s) => (
            <button
              key={s}
              onClick={() => setSegment(segment === s ? "" : s)}
              className={`rounded-xl border-2 bg-white p-4 text-left shadow-sm transition ${segment === s ? SEGMENT[s].tile : "border-transparent hover:border-slate-200"}`}
            >
              <p className="text-xs text-slate-500">{SEGMENT[s].label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{data.summary[s].toLocaleString()}</p>
              <p className="mt-0.5 text-xs text-slate-400">{SEGMENT[s].help}</p>
            </button>
          ))}
        </div>
      )}

      {data && data.canManage && inactiveCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <UserMinus size={16} />
          <span>
            <strong>{inactiveCount.toLocaleString()}</strong> {inactiveCount === 1 ? "person hasn't" : "people haven't"} opened or clicked any of
            their last {minSends}+ emails. Emailing them hurts how Gmail treats all your mail.
          </span>
          {confirmStop ? (
            <span className="ml-auto flex items-center gap-2">
              Stop emailing them?
              <button onClick={stopInactive} disabled={stopping} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white">
                {stopping ? "Working…" : "Yes, stop"}
              </button>
              <button onClick={() => setConfirmStop(false)} className="text-xs">
                Cancel
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmStop(true)} className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white">
              Stop emailing inactive people
            </button>
          )}
        </div>
      )}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className={cardClass}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or name" className={inputClass + " pl-8"} />
          </div>
          <button onClick={exportCsv} disabled={!data || data.people.length === 0} className={secondaryButton}>
            <Download size={13} /> Export CSV
          </button>
        </div>
        {data && (
          <p className="mt-3 text-xs text-slate-500">
            {data.matching.toLocaleString()} {segment ? SEGMENT[segment].label.toLowerCase() : ""} {data.matching === 1 ? "person" : "people"}
            {data.matching > data.people.length ? ` · showing the ${data.people.length.toLocaleString()} least engaged` : ""} · from{" "}
            {data.trackedSends} tracked send{data.trackedSends === 1 ? "" : "s"}
            {data.alreadyStopped ? ` · ${data.alreadyStopped.toLocaleString()} already on the do-not-email list (not shown)` : ""}
          </p>
        )}
        {data && data.people.length === 0 ? (
          <div className="mt-6 text-center">
            <Activity size={22} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm text-slate-600">{data.trackedSends === 0 ? "No tracked sends in this period yet." : "Nobody matches."}</p>
          </div>
        ) : (
          data && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Score</th>
                    <th className="py-2 pr-3 font-medium">Emails</th>
                    <th className="py-2 pr-3 font-medium">Opened</th>
                    <th className="py-2 pr-3 font-medium">Clicked</th>
                    <th className="py-2 pr-3 font-medium">Last opened / clicked</th>
                    <th className="py-2 font-medium">Segment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.people.map((p) => (
                    <tr key={p.email}>
                      <td className="py-2 pr-3">
                        <button onClick={() => onOpenContact(p.email)} className="text-slate-800 hover:text-indigo-600 hover:underline">
                          {p.email}
                        </button>
                        {p.name && <span className="ml-2 text-xs text-slate-400">{p.name}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full ${p.score >= 50 ? "bg-emerald-500" : p.score > 0 ? "bg-amber-400" : "bg-red-400"}`}
                              style={{ width: `${Math.max(4, p.score)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600">{p.score}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{p.received}</td>
                      <td className="py-2 pr-3 text-slate-600">{p.opened}</td>
                      <td className="py-2 pr-3 text-slate-600">{p.clicked}</td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{p.lastEngagedAt ? formatDate(p.lastEngagedAt) : "Never"}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEGMENT[p.segment].badge}`}>{SEGMENT[p.segment].label}</span>
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
