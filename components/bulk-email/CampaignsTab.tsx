"use client";

// Email Marketing → Campaigns: named campaigns grouping several emails.
// The list shows each campaign's combined results; opening one shows its
// drafts (edit in Compose) and its sends (open in History).

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileBarChart,
  Check,
  FileEdit,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "@/lib/api/client";
import { cardClass, formatDate, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";
import { downloadReportCsv, openReportWindow, writeReport, type ReportData } from "./report";

interface Counts {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}

interface Stats {
  counts: Counts;
  emails: { drafts: number; scheduled: number; sending: number; sent: number; stopped: number };
}

interface CampaignRow extends Stats {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  lastActivityAt?: string;
}

interface CampaignDetail extends Stats {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  drafts: { id: string; subject: string; recipientCount: number; updatedAt: string }[];
  sends: (Counts & {
    id: string;
    subject: string;
    status: "scheduled" | "sending" | "completed" | "cancelled" | "failed";
    createdAt: string;
    completedAt?: string;
    scheduledAt?: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
  })[];
  canManage: boolean;
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-sky-50 text-sky-700",
  sending: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-600",
  failed: "bg-red-50 text-red-700",
};

function emailSummary(e: Stats["emails"]) {
  const parts = [
    e.sent && `${e.sent} sent`,
    e.sending && `${e.sending} sending`,
    e.scheduled && `${e.scheduled} scheduled`,
    e.drafts && `${e.drafts} draft${e.drafts === 1 ? "" : "s"}`,
    e.stopped && `${e.stopped} stopped`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No emails yet";
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function CampaignsTab({
  selectedId,
  onSelect,
  onNewEmail,
  onEditDraft,
  onOpenSend,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNewEmail: (campaign: { id: string; name: string }) => void;
  onEditDraft: (draftId: string) => void;
  onOpenSend: (jobId: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [creating, setCreating] = useState<{ name: string; description: string } | null>(null);
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadList() {
    try {
      const res = await apiGet<{ campaigns: CampaignRow[]; canManage: boolean }>("/api/email/campaigns");
      setCampaigns(res.campaigns);
      setCanManage(res.canManage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load campaigns.");
    }
  }

  async function loadDetail(id: string) {
    try {
      setDetail(await apiGet<CampaignDetail>(`/api/email/campaigns/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load the campaign.");
      onSelect(null);
    }
  }

  useEffect(() => {
    setError(null);
    setEditing(null);
    setConfirmDelete(false);
    if (selectedId) {
      setDetail(null);
      loadDetail(selectedId);
    } else {
      loadList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function create() {
    if (!creating?.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ id: string }>("/api/email/campaigns", creating);
      setCreating(null);
      onSelect(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the campaign.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!detail || !editing?.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/email/campaigns/${detail.id}`, editing);
      setEditing(null);
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the campaign.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!detail) return;
    setBusy(true);
    try {
      await apiDelete(`/api/email/campaigns/${detail.id}`);
      onSelect(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the campaign.");
    } finally {
      setBusy(false);
    }
  }

  /** Report for the open campaign: a print-ready tab, or a CSV. */
  async function report(kind: "print" | "csv") {
    if (!detail) return;
    const w = kind === "print" ? openReportWindow() : null;
    try {
      const r = await apiGet<{
        name: string;
        description: string;
        counts: ReportData["totals"];
        sends: (ReportData["totals"] & { subject: string; status: string; date?: string })[];
        topLinks: ReportData["links"];
      }>(`/api/email/campaigns/${detail.id}/report`);
      const data: ReportData = {
        title: r.name,
        subtitle: r.description ? `Campaign · ${r.description}` : "Campaign",
        totals: r.counts,
        emails: r.sends,
        links: r.topLinks,
      };
      if (kind === "print") writeReport(w, data);
      else downloadReportCsv(`${r.name.replace(/[^\w-]+/g, "-").toLowerCase() || "campaign"}-report.csv`, data);
    } catch (err) {
      w?.close();
      setError(err instanceof ApiError ? err.message : "Couldn't build the report.");
    }
  }

  async function deleteDraft(id: string) {
    if (!detail) return;
    try {
      await apiDelete(`/api/email/drafts/${id}`);
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the draft.");
    }
  }

  // ---- One campaign ----
  if (selectedId) {
    if (!detail) {
      return (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading campaign…
        </p>
      );
    }
    const c = detail.counts;
    const totalEmails = detail.drafts.length + detail.sends.length;
    return (
      <div className="space-y-4">
        <button onClick={() => onSelect(null)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft size={14} /> All campaigns
        </button>

        <div className={cardClass}>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Campaign name</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} autoFocus />
              </div>
              <div>
                <label className={labelClass}>Description (optional)</label>
                <input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={saveEdit} disabled={busy || !editing.name.trim()} className={primaryButton}>
                  <Check size={15} /> Save
                </button>
                <button onClick={() => setEditing(null)} className="text-sm text-slate-500 hover:text-slate-900">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl font-bold text-slate-900">{detail.name}</h2>
                {detail.description && <p className="mt-1 text-sm text-slate-600">{detail.description}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  Created {formatDate(detail.createdAt)} · {emailSummary(detail.emails)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {detail.canManage && (
                  <button onClick={() => onNewEmail({ id: detail.id, name: detail.name })} className={primaryButton}>
                    <Plus size={15} /> New email
                  </button>
                )}
                <button onClick={() => report("print")} className={secondaryButton}>
                  <FileBarChart size={13} /> Report
                </button>
                <button onClick={() => report("csv")} className={secondaryButton}>
                  <Download size={13} /> CSV
                </button>
                <button onClick={() => loadDetail(detail.id)} className={secondaryButton} aria-label="Refresh">
                  <RefreshCw size={13} />
                </button>
                {detail.canManage && (
                  <>
                    <button
                      onClick={() => setEditing({ name: detail.name, description: detail.description })}
                      className={secondaryButton}
                      aria-label="Rename campaign"
                    >
                      <Pencil size={13} />
                    </button>
                    {confirmDelete ? (
                      <span className="flex items-center gap-2 text-xs">
                        Delete campaign{detail.drafts.length ? ` and its ${detail.drafts.length} draft${detail.drafts.length === 1 ? "" : "s"}` : ""}?
                        <button onClick={remove} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white">
                          Delete
                        </button>
                        <button onClick={() => setConfirmDelete(false)} className="text-slate-500">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDelete(true)} className={secondaryButton + " text-red-600"} aria-label="Delete campaign">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Combined results */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Emails" value={String(totalEmails)} sub={emailSummary(detail.emails)} />
          <Tile label="Delivered" value={c.sent.toLocaleString()} sub={`of ${c.total.toLocaleString()} recipients`} />
          <Tile label="Open rate" value={pct(c.opened, c.sent)} sub={`${c.opened.toLocaleString()} opened`} />
          <Tile label="Click rate" value={pct(c.clicked, c.sent)} sub={`${c.clicked.toLocaleString()} clicked`} />
          <Tile
            label="Problems"
            value={(c.failed + c.bounced + c.complained).toLocaleString()}
            sub={`${c.failed} failed · ${c.bounced} bounced · ${c.complained} spam`}
          />
        </div>

        {/* Drafts */}
        <div className={cardClass}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileEdit size={15} className="text-slate-400" /> Drafts
          </h3>
          {detail.drafts.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No drafts. {detail.canManage && "Use “New email” to write one -- save it as a draft and finish it later."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {detail.drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{d.subject || "(no subject)"}</p>
                    <p className="text-xs text-slate-400">
                      {d.recipientCount.toLocaleString()} recipient{d.recipientCount === 1 ? "" : "s"} · saved {formatDate(d.updatedAt)}
                    </p>
                  </div>
                  {detail.canManage && (
                    <div className="flex gap-2">
                      <button onClick={() => onEditDraft(d.id)} className={secondaryButton}>
                        <Pencil size={13} /> Edit &amp; send
                      </button>
                      <button onClick={() => deleteDraft(d.id)} className={secondaryButton + " text-red-600"} aria-label="Delete draft">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sends */}
        <div className={cardClass}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Send size={15} className="text-slate-400" /> Sent &amp; scheduled
          </h3>
          {detail.sends.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Nothing sent in this campaign yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Subject</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Delivered</th>
                    <th className="py-2 pr-3 font-medium">Opened</th>
                    <th className="py-2 pr-3 font-medium">Clicked</th>
                    <th className="py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.sends.map((s) => (
                    <tr key={s.id} onClick={() => onOpenSend(s.id)} className="cursor-pointer hover:bg-slate-50">
                      <td className="max-w-[260px] truncate py-2 pr-3 font-medium text-slate-800">{s.subject}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ""}`}>{s.status}</span>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {s.sent.toLocaleString()} / {s.total.toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{s.trackOpens ? `${pct(s.opened, s.sent)} · ${s.opened}` : "—"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.trackClicks ? `${pct(s.clicked, s.sent)} · ${s.clicked}` : "—"}</td>
                      <td className="py-2 text-xs text-slate-500">
                        {s.status === "scheduled" && s.scheduledAt ? `Scheduled ${formatDate(s.scheduledAt)}` : formatDate(s.completedAt ?? s.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-400">Click a row to see every recipient in History.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- All campaigns ----
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Group related emails -- e.g. a teaser, the launch and a reminder -- and see their results together.
        </p>
        {canManage && !creating && (
          <button onClick={() => setCreating({ name: "", description: "" })} className={primaryButton}>
            <Plus size={15} /> New campaign
          </button>
        )}
      </div>

      {creating && (
        <div className={cardClass + " space-y-3"}>
          <div>
            <label className={labelClass}>Campaign name</label>
            <input
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Diwali Sale 2026"
              className={inputClass}
              autoFocus
            />
          </div>
          <div>
            <label className={labelClass}>Description (optional)</label>
            <input
              value={creating.description}
              onChange={(e) => setCreating({ ...creating, description: e.target.value })}
              placeholder="Teaser, launch and last-day reminder"
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={busy || !creating.name.trim()} className={primaryButton}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Create campaign
            </button>
            <button onClick={() => setCreating(null)} className="text-sm text-slate-500 hover:text-slate-900">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {campaigns === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : campaigns.length === 0 ? (
        !creating && (
          <div className={cardClass + " text-center"}>
            <Megaphone size={22} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm text-slate-600">No campaigns yet.</p>
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Emails</th>
                <th className="px-4 py-3 font-medium">Delivered</th>
                <th className="px-4 py-3 font-medium">Open rate</th>
                <th className="px-4 py-3 font-medium">Click rate</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.map((c) => (
                <tr key={c.id} onClick={() => onSelect(c.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{c.name}</p>
                    {c.description && <p className="max-w-[280px] truncate text-xs text-slate-400">{c.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{emailSummary(c.emails)}</td>
                  <td className="px-4 py-3 text-slate-600">{c.counts.sent.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-600">{pct(c.counts.opened, c.counts.sent)}</td>
                  <td className="px-4 py-3 text-slate-600">{pct(c.counts.clicked, c.counts.sent)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDate(c.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
