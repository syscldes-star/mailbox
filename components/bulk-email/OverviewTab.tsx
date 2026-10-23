"use client";

// Email Marketing → Overview: headline numbers (with change vs the
// previous period), opens and clicks over time, list growth, and your
// best emails. One filter row (period + campaign) scopes everything.

import { useEffect, useState } from "react";
import { Lightbulb, Table2, LineChart as LineIcon, Loader2 } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";
import { cardClass } from "./ui";
import { BarChart, DivergingBarChart, Legend, LineChart, SERIES } from "./charts";

type Rate = number | null;

interface Totals {
  sends: number;
  sent: number;
  openRate: Rate;
  clickRate: Rate;
  bounceRate: Rate;
  complaintRate: Rate;
  unsubscribed: number;
}

interface BestRow {
  id: string;
  subject: string;
  createdAt: string;
  campaign: string | null;
  sent: number;
  openRate: Rate;
  clickRate: Rate;
  unsubscribed: number;
  topLink: string | null;
}

interface Stats {
  days: number;
  bucket: "day" | "week";
  totals: Totals;
  previous: Totals;
  timeline: {
    start: string;
    end: string;
    sent: number;
    opened: number;
    clicked: number;
    openRate: Rate;
    clickRate: Rate;
    emails: string[];
    emailCount: number;
    activityOpens: number;
    activityClicks: number;
  }[];
  growth: {
    joined: number;
    left: number;
    previousJoined: number;
    previousLeft: number;
    previousUnsubscribed: number;
    leftByReason: Record<string, number>;
    byForm: { form: string; joined: number }[];
    buckets: { start: string; end: string; joined: number; left: number; leftBy: Record<string, number> }[];
  };
  best: { open: BestRow[]; click: BestRow[]; unsubscribed: BestRow[] };
  insight: string | null;
}

const BOUNCE_WARN = 0.02;
const COMPLAINT_WARN = 0.001;
const VOLUME = "#a8a7a2";
const LEFT_REASON: Record<string, string> = {
  unsubscribed: "unsubscribed",
  bounced: "bounced",
  complained: "spam complaints",
  inactive: "inactive (stopped)",
  manual: "added by hand",
};

const pct = (v: Rate, digits = 1) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** "▲ up 4.1 pts" for rates, "▲ up 12%" for counts. Neutral ink: whether
 * up is good depends on the metric (opens vs bounces), so it's spelled out. */
function Delta({ now, before, kind, periodLabel }: { now: number | null; before: number | null; kind: "rate" | "count"; periodLabel: string }) {
  if (now === null || before === null) return <span className="text-slate-400">no earlier data</span>;
  if (kind === "count" && before === 0) return <span className="text-slate-400">{now ? "new this period" : `same as previous ${periodLabel}`}</span>;
  const diff = kind === "rate" ? (now - before) * 100 : ((now - before) / before) * 100;
  if (Math.abs(diff) < 0.05) return <span className="text-slate-500">same as previous {periodLabel}</span>;
  const text = kind === "rate" ? `${Math.abs(diff).toFixed(1)} pts` : `${Math.abs(diff).toFixed(0)}%`;
  return (
    <span className="text-slate-500">
      <span aria-hidden>{diff > 0 ? "▲" : "▼"}</span> {diff > 0 ? "up" : "down"} {text} vs previous {periodLabel}
    </span>
  );
}

function Tile({ label, value, delta, warn }: { label: string; value: string; delta: React.ReactNode; warn?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs">{delta}</p>
      {warn && <p className="mt-1 text-xs font-medium text-red-700">⚠ {warn}</p>}
    </div>
  );
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (t: boolean) => void }) {
  return (
    <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
      {[false, true].map((t) => (
        <button
          key={String(t)}
          onClick={() => onChange(t)}
          className={`flex items-center gap-1 rounded px-2 py-1 ${table === t ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
          aria-pressed={table === t}
        >
          {t ? <Table2 size={12} /> : <LineIcon size={12} />} {t ? "Table" : "Chart"}
        </button>
      ))}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-slate-100">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1.5 ${j ? "text-right tabular-nums text-slate-700" : "text-slate-600"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OverviewTab({ onOpenSend }: { onOpenSend: (jobId: string) => void }) {
  const [days, setDays] = useState(30);
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timelineMode, setTimelineMode] = useState<"send" | "activity">("send");
  const [timelineTable, setTimelineTable] = useState(false);
  const [growthTable, setGrowthTable] = useState(false);
  const [bestTab, setBestTab] = useState<"open" | "click" | "unsubscribed">("open");

  useEffect(() => {
    apiGet<{ campaigns: { id: string; name: string }[] }>("/api/email/campaigns")
      .then((r) => setCampaigns(r.campaigns.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Keep the previous render (dimmed) while refetching -- no layout jump.
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days), tz: String(-new Date().getTimezoneOffset()) });
    if (campaignId) params.set("campaignId", campaignId);
    apiGet<Stats>(`/api/email/bulk/stats?${params}`)
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load stats."))
      .finally(() => setLoading(false));
  }, [days, campaignId]);

  const periodLabel = days === 365 ? "12 months" : `${days} days`;
  const tl = stats?.timeline ?? [];
  const isWeek = stats?.bucket === "week";
  const labels = tl.map((b) => day(b.start));
  const titles = tl.map((b) => (isWeek ? `Week of ${day(b.start)} – ${day(b.end)}` : new Date(b.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })));
  const g = stats?.growth;
  const gTitles = (g?.buckets ?? []).map((b) => (isWeek ? `Week of ${day(b.start)} – ${day(b.end)}` : day(b.start)));
  const unsubNow = campaignId ? stats?.totals.unsubscribed ?? 0 : stats?.growth.leftByReason.unsubscribed ?? 0;
  const unsubBefore = campaignId ? stats?.previous.unsubscribed ?? 0 : stats?.growth.previousUnsubscribed ?? 0;
  const bestRows = stats?.best[bestTab] ?? [];

  return (
    <div className="space-y-4">
      {/* One filter row scopes everything below. */}
      <div className="flex flex-wrap items-center gap-3">
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
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          aria-label="Campaign"
        >
          <option value="">All emails</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              Campaign: {c.name}
            </option>
          ))}
        </select>
        {loading && stats && <Loader2 size={15} className="animate-spin text-slate-400" />}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!stats ? (
        !error && <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {stats.insight && (
            <p className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <Lightbulb size={16} className="shrink-0" /> {stats.insight}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Tile
              label="Emails delivered"
              value={stats.totals.sent.toLocaleString()}
              delta={<Delta now={stats.totals.sent} before={stats.previous.sent} kind="count" periodLabel={periodLabel} />}
            />
            <Tile
              label="Open rate"
              value={pct(stats.totals.openRate)}
              delta={<Delta now={stats.totals.openRate} before={stats.previous.openRate} kind="rate" periodLabel={periodLabel} />}
            />
            <Tile
              label="Click rate"
              value={pct(stats.totals.clickRate)}
              delta={<Delta now={stats.totals.clickRate} before={stats.previous.clickRate} kind="rate" periodLabel={periodLabel} />}
            />
            <Tile
              label="Bounce rate (keep under 2%)"
              value={pct(stats.totals.bounceRate)}
              delta={<Delta now={stats.totals.bounceRate} before={stats.previous.bounceRate} kind="rate" periodLabel={periodLabel} />}
              warn={stats.totals.bounceRate !== null && stats.totals.bounceRate > BOUNCE_WARN ? "High -- clean your lists" : undefined}
            />
            <Tile
              label="Spam complaint rate (keep under 0.1%)"
              value={pct(stats.totals.complaintRate, 2)}
              delta={<Delta now={stats.totals.complaintRate} before={stats.previous.complaintRate} kind="rate" periodLabel={periodLabel} />}
              warn={stats.totals.complaintRate !== null && stats.totals.complaintRate > COMPLAINT_WARN ? "High -- risks the spam folder" : undefined}
            />
            <Tile
              label={campaignId ? "Unsubscribes from this campaign" : "Unsubscribes"}
              value={unsubNow.toLocaleString()}
              delta={<Delta now={unsubNow} before={unsubBefore} kind="count" periodLabel={periodLabel} />}
            />
          </div>

          {/* ---- Opens and clicks over time ---- */}
          <div className={cardClass}>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Opens and clicks over time</h2>
              <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
                {(["send", "activity"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTimelineMode(m)}
                    aria-pressed={timelineMode === m}
                    className={`rounded px-2 py-1 ${timelineMode === m ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    {m === "send" ? "Rates, by send date" : "Activity, by day it happened"}
                  </button>
                ))}
              </div>
              <div className="ml-auto">
                <ViewToggle table={timelineTable} onChange={setTimelineTable} />
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {timelineMode === "send"
                ? "How each period's emails performed: the share of delivered emails that were opened or clicked."
                : "When people actually opened or clicked (first time per email), whichever email it was -- late openers included."}
            </p>
            {stats.totals.sent === 0 && timelineMode === "send" ? (
              <p className="py-10 text-center text-sm text-slate-400">Nothing sent in this period.</p>
            ) : timelineTable ? (
              <DataTable
                head={timelineMode === "send" ? [isWeek ? "Week of" : "Day", "Delivered", "Open rate", "Click rate", "Emails"] : [isWeek ? "Week of" : "Day", "People opened", "People clicked"]}
                rows={tl.map((b, i) =>
                  timelineMode === "send"
                    ? [titles[i], b.sent.toLocaleString(), pct(b.openRate), pct(b.clickRate), b.emailCount]
                    : [titles[i], b.activityOpens.toLocaleString(), b.activityClicks.toLocaleString()]
                )}
              />
            ) : (
              <>
                <Legend
                  items={[
                    { label: timelineMode === "send" ? "Open rate" : "Opened", color: SERIES.blue, kind: "line" },
                    { label: timelineMode === "send" ? "Click rate" : "Clicked", color: SERIES.orange, kind: "line" },
                  ]}
                />
                {timelineMode === "send" ? (
                  <>
                    <LineChart
                      ariaLabel="Open and click rate over time. Use the left and right arrow keys to read each period."
                      labels={labels}
                      tooltipTitles={titles}
                      series={[
                        { label: "opened", color: SERIES.blue, values: tl.map((b) => b.openRate) },
                        { label: "clicked", color: SERIES.orange, values: tl.map((b) => b.clickRate) },
                      ]}
                      format={(v) => `${Math.round(v * 100)}%`}
                      connectGaps
                      extra={(i) =>
                        tl[i].emailCount ? (
                          <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-slate-500">
                            <p>{tl[i].sent.toLocaleString()} delivered · {tl[i].emailCount} email{tl[i].emailCount === 1 ? "" : "s"}</p>
                            {tl[i].emails.map((s) => (
                              <p key={s} className="truncate text-slate-700">• {s}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-slate-400">Nothing sent</p>
                        )
                      }
                    />
                    <p className="mt-2 text-xs font-medium text-slate-500">Emails delivered</p>
                    <BarChart
                      ariaLabel="Emails delivered per period"
                      labels={labels}
                      tooltipTitles={titles}
                      values={tl.map((b) => b.sent)}
                      color={VOLUME}
                      label="delivered"
                    />
                  </>
                ) : (
                  <LineChart
                    ariaLabel="People who opened and clicked per period. Use the left and right arrow keys to read each period."
                    labels={labels}
                    tooltipTitles={titles}
                    series={[
                      { label: "opened", color: SERIES.blue, values: tl.map((b) => b.activityOpens) },
                      { label: "clicked", color: SERIES.orange, values: tl.map((b) => b.activityClicks) },
                    ]}
                    format={(v) => Math.round(v).toLocaleString()}
                  />
                )}
              </>
            )}
          </div>

          {/* ---- List growth ---- */}
          {g && (
            <div className={cardClass}>
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-900">List growth</h2>
                <div className="ml-auto">
                  <ViewToggle table={growthTable} onChange={setGrowthTable} />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Joined = confirmed through a signup form. Left = unsubscribed, bounced, spam complaints, or stopped as inactive.
                {campaignId && " Covers your whole workspace, not just this campaign."}
              </p>
              <div className="my-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-sm text-slate-700">
                  <span className="text-xl font-semibold text-slate-900">+{g.joined.toLocaleString()}</span> joined
                </p>
                <p className="text-sm text-slate-700">
                  <span className="text-xl font-semibold text-slate-900">−{g.left.toLocaleString()}</span> left
                </p>
                <p className="text-sm text-slate-700">
                  <span className="text-xl font-semibold text-slate-900">
                    {g.joined - g.left > 0 ? "+" : g.joined - g.left < 0 ? "−" : ""}
                    {Math.abs(g.joined - g.left).toLocaleString()}
                  </span>{" "}
                  net
                </p>
                <p className="text-xs">
                  <Delta now={g.joined - g.left} before={g.previousJoined - g.previousLeft} kind="count" periodLabel={periodLabel} />
                </p>
              </div>
              {growthTable ? (
                <DataTable
                  head={[isWeek ? "Week of" : "Day", "Joined", "Left", "Net", "Why they left"]}
                  rows={g.buckets.map((b, i) => [
                    gTitles[i],
                    b.joined,
                    b.left,
                    b.joined - b.left,
                    Object.entries(b.leftBy).filter(([, n]) => n).map(([r, n]) => `${n} ${LEFT_REASON[r] ?? r}`).join(", ") || "—",
                  ])}
                />
              ) : (
                <>
                  <Legend
                    items={[
                      { label: "Joined", color: SERIES.blue, kind: "bar" },
                      { label: "Left", color: SERIES.red, kind: "bar" },
                    ]}
                  />
                  <DivergingBarChart
                    ariaLabel="People who joined and left per period. Use the left and right arrow keys to read each period."
                    labels={g.buckets.map((b) => day(b.start))}
                    tooltipTitles={gTitles}
                    up={g.buckets.map((b) => b.joined)}
                    down={g.buckets.map((b) => b.left)}
                    upLabel="joined"
                    downLabel="left"
                    extra={(i) => {
                      const why = Object.entries(g.buckets[i].leftBy).filter(([, n]) => n);
                      return why.length ? (
                        <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-slate-500">
                          {why.map(([r, n]) => (
                            <p key={r}>
                              {n} {LEFT_REASON[r] ?? r}
                            </p>
                          ))}
                        </div>
                      ) : null;
                    }}
                  />
                </>
              )}
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600">Why people left</p>
                  {g.left === 0 ? (
                    <p className="text-xs text-slate-400">Nobody left in this period.</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-slate-600">
                      {Object.entries(g.leftByReason)
                        .sort((a, b) => b[1] - a[1])
                        .map(([r, n]) => (
                          <li key={r} className="flex justify-between">
                            <span>{LEFT_REASON[r] ?? r}</span>
                            <span className="tabular-nums text-slate-900">{n.toLocaleString()}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600">Where people joined</p>
                  {g.byForm.length === 0 ? (
                    <p className="text-xs text-slate-400">No signups in this period.</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-slate-600">
                      {g.byForm.map((f) => (
                        <li key={f.form} className="flex justify-between">
                          <span className="truncate">{f.form}</span>
                          <span className="tabular-nums text-slate-900">{f.joined.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---- Best emails ---- */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Your best emails</h2>
              <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
                {(
                  [
                    ["open", "Highest open rate"],
                    ["click", "Highest click rate"],
                    ["unsubscribed", "Most unsubscribes"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setBestTab(k)}
                    aria-pressed={bestTab === k}
                    className={`rounded px-2 py-1 ${bestTab === k ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5 text-right">Delivered</th>
                  <th className="px-4 py-2.5 text-right">Opened</th>
                  <th className="px-4 py-2.5 text-right">Clicked</th>
                  <th className="px-4 py-2.5 text-right">Unsubscribed</th>
                  <th className="px-4 py-2.5">Top link</th>
                </tr>
              </thead>
              <tbody>
                {bestRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      {bestTab === "unsubscribed"
                        ? "No unsubscribes traced to an email in this period."
                        : "No emails to rank yet in this period."}
                    </td>
                  </tr>
                ) : (
                  bestRows.map((r, i) => (
                    <tr key={r.id} onClick={() => onOpenSend(r.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-xs text-slate-400">{i + 1}</td>
                      <td className="max-w-[300px] px-4 py-2.5">
                        <p className="truncate font-medium text-slate-800">{r.subject}</p>
                        <p className="text-xs text-slate-400">
                          {day(r.createdAt)}
                          {r.campaign && ` · ${r.campaign}`}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.sent.toLocaleString()}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${bestTab === "open" ? "font-semibold text-slate-900" : "text-slate-700"}`}>{pct(r.openRate)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${bestTab === "click" ? "font-semibold text-slate-900" : "text-slate-700"}`}>{pct(r.clickRate)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${bestTab === "unsubscribed" ? "font-semibold text-slate-900" : "text-slate-700"}`}>{r.unsubscribed.toLocaleString()}</td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-slate-500">{r.topLink ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <p className="px-4 py-2.5 text-xs text-slate-400">
              Emails sent to fewer than 20 people aren&apos;t ranked. Click a row to see it in History.
              {bestTab === "unsubscribed" && " Unsubscribes are traced to the email they came from for emails sent from now on."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
