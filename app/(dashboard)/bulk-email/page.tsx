"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Upload,
  Eye,
  Code2,
  FlaskConical,
  Users,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronRight,
  MailOpen,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api/client";
import { parseRecipients, MAX_RECIPIENTS_PER_JOB, type ParseResult } from "@/lib/bulk-email/recipients";
import { extractTags, renderTemplate, withUnsubscribeFooter } from "@/lib/bulk-email/template";

interface SenderDomain {
  domain: string;
  defaultLocalPart: string;
}

interface JobSummary {
  id: string;
  fromDomain: string;
  fromLocalPart: string;
  fromName?: string;
  subject: string;
  status: "sending" | "completed" | "cancelled" | "failed";
  error?: string;
  createdAt: string;
  completedAt?: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  trackOpens?: boolean;
  trackClicks?: boolean;
}

interface JobRecipient {
  email: string;
  name?: string;
  status: "pending" | "sent" | "failed" | "skipped";
  error?: string;
  sentAt?: string;
  openedAt?: string;
  lastOpenedAt?: string;
  openCount?: number;
  clickedAt?: string;
  lastClickedAt?: string;
  clickCount?: number;
  clickedLinks?: string[];
}

interface JobDetail extends Omit<JobSummary, "total" | "sent" | "failed" | "skipped" | "opened" | "clicked"> {
  recipients: JobRecipient[];
}

interface ListResponse {
  senders: SenderDomain[];
  canSend: boolean;
  jobs: JobSummary[];
}

type RecipientFilter = "all" | JobRecipient["status"] | "opened" | "not_opened" | "clicked";

function matchesFilter(r: JobRecipient, filter: RecipientFilter) {
  if (filter === "all") return true;
  if (filter === "opened") return !!r.openedAt;
  if (filter === "not_opened") return r.status === "sent" && !r.openedAt;
  if (filter === "clicked") return !!r.clickedAt;
  return r.status === filter;
}

const DEFAULT_BODY = `<p>Hi {{name}},</p>
<p>Write your message here.</p>
<p>Thanks,<br>The team</p>`;

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const STATUS_BADGE: Record<JobSummary["status"], string> = {
  sending: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-600",
  failed: "bg-red-50 text-red-700",
};

function formatDate(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "";
}

function downloadCsv(job: JobDetail) {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    "email,name,status,error,sent_at,opened_at,open_count,clicked_at,click_count,clicked_links",
    ...job.recipients.map((r) =>
      [
        r.email,
        r.name ?? "",
        r.status,
        r.error ?? "",
        r.sentAt ?? "",
        r.openedAt ?? "",
        String(r.openCount ?? 0),
        r.clickedAt ?? "",
        String(r.clickCount ?? 0),
        (r.clickedLinks ?? []).join(" "),
      ]
        .map(escape)
        .join(",")
    ),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `bulk-send-${job.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkEmailPage() {
  const [tab, setTab] = useState<"compose" | "history">("compose");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Compose state
  const [fromDomain, setFromDomain] = useState("");
  const [fromLocalPart, setFromLocalPart] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);
  const [recipientsText, setRecipientsText] = useState("");
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);
  const [bodyView, setBodyView] = useState<"edit" | "preview">("edit");
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const senderDefaulted = useRef(false);

  // History state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>("all");
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await apiGet<ListResponse>("/api/email/bulk");
      setData(next);
      setLoadError(null);
      if (!senderDefaulted.current && next.senders.length > 0) {
        senderDefaulted.current = true;
        setFromDomain(next.senders[0].domain);
        setFromLocalPart(next.senders[0].defaultLocalPart);
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Failed to load bulk email.");
    }
  }

  async function refreshDetail(id: string) {
    try {
      setDetail(await apiGet<JobDetail>(`/api/email/bulk/${id}`));
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "Failed to load send details.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const anySending = data?.jobs.some((j) => j.status === "sending") ?? false;
  // Opens keep arriving after a send finishes, so an expanded send keeps
  // refreshing too -- just less often.
  useEffect(() => {
    if (!anySending && !expandedId) return;
    const interval = setInterval(
      () => {
        refresh();
        if (expandedId) refreshDetail(expandedId);
      },
      anySending ? 3000 : 30000
    );
    return () => clearInterval(interval);
  }, [anySending, expandedId]);

  const parsed: ParseResult & { parseError?: string } = useMemo(() => {
    if (!recipientsText.trim()) return { recipients: [], invalid: [], duplicates: 0, columns: ["email", "name"] };
    try {
      return parseRecipients(recipientsText);
    } catch (err) {
      return {
        recipients: [],
        invalid: [],
        duplicates: 0,
        columns: [],
        parseError: err instanceof Error ? err.message : "Couldn't parse recipients.",
      };
    }
  }, [recipientsText]);

  const availableTags = useMemo(
    () => [...new Set([...parsed.columns, "email", "name", "unsubscribe_url"])],
    [parsed.columns]
  );
  const unknownTags = useMemo(
    () => extractTags(subject + " " + bodyHtml).filter((t) => !availableTags.includes(t)),
    [subject, bodyHtml, availableTags]
  );

  const sample = parsed.recipients[0] ?? { email: "recipient@example.com", name: "Alex", vars: {} };
  const previewVars = { ...sample.vars, email: sample.email, name: sample.name ?? "", unsubscribe_url: "#" };
  const previewHtml = renderTemplate(withUnsubscribeFooter(bodyHtml), previewVars, { html: true });
  const previewSubject = renderTemplate(subject, previewVars, { html: false });

  const tooMany = parsed.recipients.length > MAX_RECIPIENTS_PER_JOB;
  const canSend = data?.canSend ?? false;
  const noSenders = data !== null && data.senders.length === 0;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRecipientsText(await file.text());
    e.target.value = "";
  }

  function insertTag(tag: string) {
    setBodyHtml((b) => b + `{{${tag}}}`);
    setBodyView("edit");
  }

  function draftPayload() {
    return { fromDomain, fromLocalPart, fromName, replyTo, subject, bodyHtml };
  }

  async function handleTest() {
    setTesting(true);
    setComposeError(null);
    setComposeNotice(null);
    try {
      await apiPost("/api/email/bulk/test", { ...draftPayload(), testEmail, sample });
      setComposeNotice(`Test email sent to ${testEmail}.`);
    } catch (err) {
      setComposeError(err instanceof ApiError ? err.message : "Test send failed.");
    } finally {
      setTesting(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setComposeError(null);
    setComposeNotice(null);
    try {
      const result = await apiPost<{ id: string; total: number }>("/api/email/bulk", {
        ...draftPayload(),
        trackOpens,
        trackClicks,
        recipients: parsed.recipients,
      });
      setConfirming(false);
      setRecipientsText("");
      setSubject("");
      setBodyHtml(DEFAULT_BODY);
      await refresh();
      setTab("history");
      setExpandedId(result.id);
      refreshDetail(result.id);
    } catch (err) {
      setComposeError(err instanceof ApiError ? err.message : "Failed to start the send.");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  async function jobAction(id: string, action: "cancel" | "resume" | "retry_failed") {
    setActionPending(id + action);
    setHistoryError(null);
    try {
      await apiPatch(`/api/email/bulk/${id}`, { action });
      await refresh();
      await refreshDetail(id);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setActionPending(null);
    }
  }

  function toggleExpanded(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setRecipientFilter("all");
    refreshDetail(id);
  }

  const formValid =
    !!fromDomain &&
    !!fromLocalPart.trim() &&
    !!subject.trim() &&
    !!bodyHtml.trim() &&
    parsed.recipients.length > 0 &&
    !tooMany;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold text-slate-900">Bulk Email</h1>
          <p className="mt-1 text-sm text-slate-500">
            Send a personalised email to a list of recipients from one of your domains.
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(["compose", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? "rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-md px-4 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
              }
            >
              {t === "compose" ? "Compose" : `History${anySending ? " •" : ""}`}
            </button>
          ))}
        </div>
      </div>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {tab === "compose" && (
        <div className="space-y-4">
          {noSenders && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              No domain is ready to send from yet. A domain can send once its &quot;Approved sender&quot; step is
              complete on the Domains page.
            </div>
          )}
          {data && !canSend && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Your role can view bulk sends but not send them. Ask a manager, admin, or owner.
            </div>
          )}

          {/* Sender */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Sender</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>From address</label>
                <div className="flex items-center gap-1">
                  <input
                    value={fromLocalPart}
                    onChange={(e) => setFromLocalPart(e.target.value)}
                    placeholder="newsletter"
                    className={inputClass}
                  />
                  <span className="text-sm text-slate-400">@</span>
                  <select
                    value={fromDomain}
                    onChange={(e) => setFromDomain(e.target.value)}
                    className={inputClass}
                    disabled={noSenders}
                  >
                    {data?.senders.map((s) => (
                      <option key={s.domain} value={s.domain}>
                        {s.domain}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>From name</label>
                <input
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="Acme Inc."
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Reply-to (optional)</label>
                <input
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@yourdomain.com"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Recipients */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recipients</h2>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Upload size={14} />
                Upload CSV
              </button>
              <input ref={fileInput} type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} hidden />
            </div>
            <textarea
              value={recipientsText}
              onChange={(e) => setRecipientsText(e.target.value)}
              rows={6}
              placeholder={
                "One per line:  jane@example.com, Jane Doe\n" +
                "or paste a CSV with a header row:  email,name,company\n" +
                "Every CSV column becomes a merge tag, e.g. {{company}}"
              }
              className={inputClass + " font-mono text-xs"}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1 font-medium text-slate-700">
                <Users size={14} />
                {parsed.recipients.length.toLocaleString()} recipient{parsed.recipients.length === 1 ? "" : "s"}
              </span>
              {parsed.duplicates > 0 && <span className="text-slate-500">{parsed.duplicates} duplicates removed</span>}
              {parsed.invalid.length > 0 && (
                <span className="text-amber-700" title={parsed.invalid.slice(0, 20).join("\n")}>
                  {parsed.invalid.length} invalid line{parsed.invalid.length === 1 ? "" : "s"} ignored
                </span>
              )}
              {tooMany && (
                <span className="text-red-600">
                  Limit is {MAX_RECIPIENTS_PER_JOB.toLocaleString()} per send — split your list.
                </span>
              )}
              {parsed.parseError && <span className="text-red-600">{parsed.parseError}</span>}
            </div>
          </div>

          {/* Message */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Message</h2>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="A quick update for {{name}}"
                  className={inputClass}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelClass + " mb-0"}>Body (HTML)</label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setBodyView("edit")}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${bodyView === "edit" ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500"}`}
                    >
                      <Code2 size={13} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setBodyView("preview")}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${bodyView === "preview" ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500"}`}
                    >
                      <Eye size={13} /> Preview
                    </button>
                  </div>
                </div>
                {bodyView === "edit" ? (
                  <textarea
                    value={bodyHtml}
                    onChange={(e) => setBodyHtml(e.target.value)}
                    rows={12}
                    className={inputClass + " font-mono text-xs"}
                  />
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p>
                        <span className="text-slate-400">To:</span> {sample.name ? `${sample.name} <${sample.email}>` : sample.email}
                      </p>
                      <p>
                        <span className="text-slate-400">Subject:</span> {previewSubject || <em>(no subject)</em>}
                      </p>
                    </div>
                    <iframe
                      title="Email preview"
                      sandbox=""
                      srcDoc={previewHtml}
                      className="h-80 w-full bg-white"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">Merge tags:</span>
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="rounded-full bg-indigo-50 px-2 py-0.5 font-mono text-indigo-700 hover:bg-indigo-100"
                  >
                    {`{{${tag}}}`}
                  </button>
                ))}
              </div>
              {unknownTags.length > 0 && (
                <p className="flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle size={13} />
                  {unknownTags.map((t) => `{{${t}}}`).join(", ")} {unknownTags.length === 1 ? "isn't" : "aren't"} in your
                  recipient data and will render empty.
                </p>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={trackOpens}
                  onChange={(e) => setTrackOpens(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                />
                Track opens
                <span className="text-xs text-slate-400">(adds an invisible 1×1 image to each email)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={trackClicks}
                  onChange={(e) => setTrackClicks(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                />
                Track clicks
                <span className="text-xs text-slate-400">(links go through your domain first, then on to the real page)</span>
              </label>
              <p className="text-xs text-slate-400">
                An unsubscribe link is added automatically unless you place {"{{unsubscribe_url}}"} yourself.
                Unsubscribed addresses are skipped on future sends.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="min-w-[220px] flex-1">
              <label className={labelClass}>Send a test to</label>
              <input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !canSend || !testEmail || !fromDomain || !subject || !bodyHtml}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {testing ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}
              Send test
            </button>
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-700">
                  Send to {parsed.recipients.length.toLocaleString()} recipients?
                </span>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  Yes, send
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!formValid || !canSend}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                <Send size={15} />
                Send to {parsed.recipients.length.toLocaleString()}
              </button>
            )}
          </div>
          {composeError && <p className="text-sm text-red-600">{composeError}</p>}
          {composeNotice && <p className="text-sm text-emerald-600">{composeNotice}</p>}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          {historyError && <p className="text-sm text-red-600">{historyError}</p>}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-3" />
                  <th className="px-3 py-3">Subject</th>
                  <th className="px-3 py-3">From</th>
                  <th className="px-3 py-3">Progress</th>
                  <th className="px-3 py-3">Opened</th>
                  <th className="px-3 py-3">Clicked</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {data === null ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                      Loading…
                    </td>
                  </tr>
                ) : data.jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                      No bulk sends yet.
                    </td>
                  </tr>
                ) : (
                  data.jobs.map((job) => {
                    const done = job.sent + job.failed + job.skipped;
                    const pct = job.total ? Math.round((done / job.total) * 100) : 0;
                    const expanded = expandedId === job.id;
                    return (
                      <Fragment key={job.id}>
                        <tr
                          onClick={() => toggleExpanded(job.id)}
                          className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="px-3 py-3 text-slate-400">
                            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          </td>
                          <td className="max-w-[240px] truncate px-3 py-3 font-medium text-slate-900">{job.subject}</td>
                          <td className="px-3 py-3 text-slate-600">
                            {job.fromLocalPart}@{job.fromDomain}
                          </td>
                          <td className="min-w-[180px] px-3 py-3">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {job.sent.toLocaleString()} sent
                              {job.failed > 0 && <span className="text-red-600"> · {job.failed} failed</span>}
                              {job.skipped > 0 && <span> · {job.skipped} skipped</span>} / {job.total.toLocaleString()}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs">
                            {job.trackOpens ? (
                              <>
                                <span className="font-medium text-slate-900">
                                  {job.sent ? Math.round((job.opened / job.sent) * 100) : 0}%
                                </span>
                                <span className="text-slate-500"> · {job.opened.toLocaleString()}</span>
                              </>
                            ) : (
                              <span className="text-slate-400">Not tracked</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs">
                            {job.trackClicks ? (
                              <>
                                <span className="font-medium text-slate-900">
                                  {job.sent ? Math.round((job.clicked / job.sent) * 100) : 0}%
                                </span>
                                <span className="text-slate-500"> · {job.clicked.toLocaleString()}</span>
                              </>
                            ) : (
                              <span className="text-slate-400">Not tracked</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[job.status]}`}>
                              {job.status === "sending" && <Loader2 size={11} className="mr-1 inline animate-spin" />}
                              {job.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-500">{formatDate(job.createdAt)}</td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-slate-100 bg-slate-50/50">
                            <td colSpan={8} className="px-5 py-4">
                              <JobDetailPanel
                                job={job}
                                detail={detail?.id === job.id ? detail : null}
                                canManage={canSend}
                                filter={recipientFilter}
                                onFilter={setRecipientFilter}
                                actionPending={actionPending}
                                onAction={(action) => jobAction(job.id, action)}
                                onRefresh={() => {
                                  refresh();
                                  refreshDetail(job.id);
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function JobDetailPanel({
  job,
  detail,
  canManage,
  filter,
  onFilter,
  actionPending,
  onAction,
  onRefresh,
}: {
  job: JobSummary;
  detail: JobDetail | null;
  canManage: boolean;
  filter: RecipientFilter;
  onFilter: (f: RecipientFilter) => void;
  actionPending: string | null;
  onAction: (action: "cancel" | "resume" | "retry_failed") => void;
  onRefresh: () => void;
}) {
  if (!detail) return <p className="text-xs text-slate-400">Loading details…</p>;

  const pending = detail.recipients.filter((r) => r.status === "pending").length;
  const matching = detail.recipients.filter((r) => matchesFilter(r, filter));
  const shown = matching.slice(0, 200);
  const filters: RecipientFilter[] = [
    "all",
    "sent",
    ...(job.trackOpens ? (["opened", "not_opened"] as const) : []),
    ...(job.trackClicks ? (["clicked"] as const) : []),
    "failed",
    "skipped",
    "pending",
  ];

  // Unique recipients per clicked link, most-clicked first.
  const linkCounts = new Map<string, number>();
  for (const r of detail.recipients) {
    for (const url of r.clickedLinks ?? []) linkCounts.set(url, (linkCounts.get(url) ?? 0) + 1);
  }
  const topLinks = [...linkCounts.entries()].sort((a, b) => b[1] - a[1]);
  const busy = (action: string) => actionPending === job.id + action;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {job.fromName && <span className="text-xs text-slate-500">From name: {job.fromName}</span>}
        {job.completedAt && <span className="text-xs text-slate-500">Finished {formatDate(job.completedAt)}</span>}
        {job.error && <span className="text-xs text-red-600">Error: {job.error}</span>}
        <div className="ml-auto flex gap-2">
          {canManage && job.status === "sending" && (
            <button
              onClick={() => onAction("cancel")}
              disabled={busy("cancel")}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Ban size={13} /> Cancel send
            </button>
          )}
          {canManage && job.status !== "sending" && pending > 0 && (
            <button
              onClick={() => onAction("resume")}
              disabled={busy("resume")}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Send size={13} /> Resume ({pending} left)
            </button>
          )}
          {canManage && job.status !== "sending" && job.failed > 0 && (
            <button
              onClick={() => onAction("retry_failed")}
              disabled={busy("retry_failed")}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw size={13} /> Retry {job.failed} failed
            </button>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={() => downloadCsv(detail)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      <div className="flex gap-1 text-xs">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            className={`rounded-md px-2.5 py-1 capitalize ${filter === f ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            {f.replace("_", " ")}
          </button>
        ))}
      </div>

      {topLinks.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-700">Clicked links</p>
          <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
            {topLinks.map(([url, count]) => (
              <li key={url} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <a href={url} target="_blank" rel="noreferrer" className="truncate text-indigo-600 hover:underline" title={url}>
                  {url}
                </a>
                <span className="ml-auto shrink-0 text-slate-500">
                  {count} {count === 1 ? "person" : "people"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {shown.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-400">No recipients in this view.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => (
              <li key={r.email} className="flex items-center gap-2 px-3 py-2 text-xs">
                {r.status === "sent" && <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />}
                {r.status === "failed" && <XCircle size={14} className="shrink-0 text-red-500" />}
                {r.status === "skipped" && <Ban size={14} className="shrink-0 text-slate-400" />}
                {r.status === "pending" && <Loader2 size={14} className="shrink-0 text-slate-300" />}
                <span className="font-medium text-slate-800">{r.email}</span>
                {r.name && <span className="text-slate-400">{r.name}</span>}
                {r.openedAt && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700"
                    title={`First opened ${formatDate(r.openedAt)}${r.lastOpenedAt ? ` · last ${formatDate(r.lastOpenedAt)}` : ""}`}
                  >
                    <MailOpen size={12} /> Opened{(r.openCount ?? 0) > 1 ? ` ×${r.openCount}` : ""}
                  </span>
                )}
                {r.clickedAt && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700"
                    title={(r.clickedLinks ?? []).join("\n")}
                  >
                    <MousePointerClick size={12} /> Clicked{(r.clickCount ?? 0) > 1 ? ` ×${r.clickCount}` : ""}
                  </span>
                )}
                {r.error && <span className="ml-auto truncate text-red-600" title={r.error}>{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {matching.length > shown.length && (
        <p className="text-xs text-slate-400">Showing the first 200 — export CSV for the full list.</p>
      )}
    </div>
  );
}
