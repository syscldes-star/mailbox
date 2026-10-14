"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";
import { cardClass } from "./ui";

interface Stats {
  days: number;
  totals: {
    sends: number;
    sent: number;
    openRate: number | null;
    clickRate: number | null;
    bounceRate: number | null;
    complaintRate: number | null;
    unsubscribes: number;
  };
  weeks: { weekStart: string; sent: number; opened: number; clicked: number }[];
  recent: { id: string; subject: string; createdAt: string; sent: number; openRate: number | null; clickRate: number | null; bounced: number }[];
}

// Thresholds mailbox providers treat as a problem.
const BOUNCE_WARN = 0.02;
const COMPLAINT_WARN = 0.001;

function pct(value: number | null, digits = 1) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: string }) {
  return (
    <div className={cardClass + " p-4"}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {warn ? (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700">
          <AlertTriangle size={12} aria-hidden /> {warn}
        </p>
      ) : (
        sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>
      )}
    </div>
  );
}

function WeeklyChart({ weeks }: { weeks: Stats["weeks"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.sent));
  const height = 160;
  // A "nice" top value for the single gridline label.
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / magnitude) * magnitude;

  return (
    <div className="relative">
      <div className="flex items-stretch gap-2">
        <div className="flex w-10 flex-col justify-between text-right text-[11px] tabular-nums text-slate-400" style={{ height }}>
          <span>{top.toLocaleString()}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1" style={{ height }}>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200" />
          <div className="absolute inset-x-0 bottom-0 border-t border-slate-300" />
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {weeks.map((w, i) => (
              <div
                key={w.weekStart}
                className="flex h-full flex-1 cursor-default items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`Week of ${shortDate(w.weekStart)}: ${w.sent.toLocaleString()} emails sent`}
              >
                <div
                  className={`w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-indigo-700" : "bg-indigo-500"}`}
                  style={{ height: w.sent > 0 ? Math.max(2, (w.sent / top) * height) : 0 }}
                />
              </div>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `${((hover + 0.5) / weeks.length) * 100}%` }}
            >
              <p className="font-medium text-slate-900">Week of {shortDate(weeks[hover].weekStart)}</p>
              <p className="tabular-nums text-slate-700">{weeks[hover].sent.toLocaleString()} sent</p>
              <p className="tabular-nums text-slate-500">
                {weeks[hover].opened.toLocaleString()} opened · {weeks[hover].clicked.toLocaleString()} clicked
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="ml-12 mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{weeks.length ? shortDate(weeks[0].weekStart) : ""}</span>
        <span>{weeks.length ? shortDate(weeks[weeks.length - 1].weekStart) : ""}</span>
      </div>
    </div>
  );
}

export default function OverviewTab() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    apiGet<Stats>(`/api/email/bulk/stats?days=${days}`)
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load stats."));
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 ${days === d ? "bg-indigo-600 font-medium text-white" : "text-slate-600 hover:text-slate-900"}`}
            >
              {d === 365 ? "12 months" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!stats ? (
        !error && <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Tile label="Emails sent" value={stats.totals.sent.toLocaleString()} sub={`${stats.totals.sends} sends`} />
            <Tile label="Open rate" value={pct(stats.totals.openRate)} sub="of tracked emails" />
            <Tile label="Click rate" value={pct(stats.totals.clickRate)} sub="of tracked emails" />
            <Tile
              label="Bounce rate"
              value={pct(stats.totals.bounceRate)}
              sub="keep under 2%"
              warn={stats.totals.bounceRate !== null && stats.totals.bounceRate > BOUNCE_WARN ? "High -- clean your lists" : undefined}
            />
            <Tile
              label="Spam complaint rate"
              value={pct(stats.totals.complaintRate, 2)}
              sub="keep under 0.1%"
              warn={stats.totals.complaintRate !== null && stats.totals.complaintRate > COMPLAINT_WARN ? "High -- risks spam folder" : undefined}
            />
            <Tile label="Unsubscribes" value={stats.totals.unsubscribes.toLocaleString()} sub={`in the last ${days === 365 ? "12 months" : `${days} days`}`} />
          </div>

          <div className={cardClass}>
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Emails sent per week</h2>
            {stats.totals.sent === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Nothing sent in this period.</p>
            ) : (
              <WeeklyChart weeks={stats.weeks} />
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Recent sends</p>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5 text-right">Sent</th>
                  <th className="px-4 py-2.5 text-right">Opened</th>
                  <th className="px-4 py-2.5 text-right">Clicked</th>
                  <th className="px-4 py-2.5 text-right">Bounced</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                      No sends in this period.
                    </td>
                  </tr>
                ) : (
                  stats.recent.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="max-w-[260px] truncate px-4 py-2.5 font-medium text-slate-800">{r.subject}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{shortDate(r.createdAt)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.sent.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{pct(r.openRate)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{pct(r.clickRate)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.bounced.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
