"use client";

// The Email Marketing panel. Rendered by app/(dashboard)/email-marketing/
// layout.tsx so it stays mounted while the sidebar switches between its
// sections (/email-marketing/<tab>) -- a draft in Compose survives a
// quick look at History, and "Send again" can hand data to Compose.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TABS, type Tab } from "./tabs";
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
  Save,
  CalendarClock,
  FileText,
  Pencil,
  Monitor,
  Smartphone,
  Link2,
  Info,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api/client";
import { parseRecipients, recipientsToCsv, MAX_RECIPIENTS_PER_JOB, type ParseResult } from "@/lib/bulk-email/recipients";
import { extractTags, renderTemplate, withFooter } from "@/lib/bulk-email/template";
import { campaignSlug } from "@/lib/bulk-email/tracking";
import { extractLinks, runPresendChecks } from "@/lib/bulk-email/presend-check";
import SettingsTab from "@/components/bulk-email/SettingsTab";
import UnsubscribesTab from "@/components/bulk-email/UnsubscribesTab";
import TemplatesTab, { type SavedTemplate } from "@/components/bulk-email/TemplatesTab";
import ListsTab from "@/components/bulk-email/ListsTab";
import DomainHealth from "@/components/bulk-email/DomainHealth";
import ContactProfile from "@/components/bulk-email/ContactProfile";
import FormsTab from "@/components/bulk-email/FormsTab";
import OverviewTab from "@/components/bulk-email/OverviewTab";
import ListPicker from "@/components/bulk-email/ListPicker";
import VisualEditor, { insertTextAtCaret, isVisualSafe } from "@/components/bulk-email/VisualEditor";

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
  status: "scheduled" | "sending" | "completed" | "cancelled" | "failed";
  scheduledAt?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  trackOpens?: boolean;
  trackClicks?: boolean;
  createdByName?: string;
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
  deliveryIssue?: "bounced" | "soft_bounced" | "complained";
  deliveryIssueAt?: string;
}

interface JobDetail extends Omit<JobSummary, "total" | "sent" | "failed" | "skipped" | "opened" | "clicked" | "bounced" | "complained"> {
  recipients: JobRecipient[];
}

interface ListResponse {
  senders: SenderDomain[];
  canSend: boolean;
  jobs: JobSummary[];
  settings: { postalAddress: string };
}


const TAB_HEADING: Record<Tab, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "How your email marketing is performing." },
  compose: { title: "Compose", subtitle: "Send a personalised email to a list of recipients from one of your domains." },
  history: { title: "History", subtitle: "Every send, with delivery, opens and clicks per recipient." },
  lists: { title: "Lists", subtitle: "Saved contact lists and segments to send to." },
  forms: { title: "Signup forms", subtitle: "Let people subscribe themselves, with email confirmation." },
  templates: { title: "Templates", subtitle: "Reusable messages for Compose." },
  unsubscribes: { title: "Unsubscribes", subtitle: "Addresses that are never emailed: unsubscribes, bounces and spam complaints." },
  settings: { title: "Settings", subtitle: "Email marketing settings for this workspace." },
};

type SendAgainAudience = "all" | "not_opened" | "not_clicked";

interface ComposeDraft {
  fromDomain?: string;
  fromLocalPart?: string;
  fromName?: string;
  replyTo?: string;
  subject?: string;
  preheader?: string;
  bodyHtml?: string;
  recipientsText?: string;
  trackOpens?: boolean;
  trackClicks?: boolean;
  utm?: { source: string; medium: string; campaign: string };
}

const DRAFT_STORAGE_KEY = "bulk-email-draft-v1";
/** Recipients per upload request when starting a send. */
const UPLOAD_BATCH = 2000;

/** Value for a datetime-local input, in the browser's own timezone. */
function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type RecipientFilter = "all" | JobRecipient["status"] | "opened" | "not_opened" | "clicked" | "bounced";

function matchesFilter(r: JobRecipient, filter: RecipientFilter) {
  if (filter === "all") return true;
  if (filter === "opened") return !!r.openedAt;
  if (filter === "not_opened") return r.status === "sent" && !r.openedAt;
  if (filter === "clicked") return !!r.clickedAt;
  if (filter === "bounced") return !!r.deliveryIssue;
  return r.status === filter;
}

const DEFAULT_BODY = `<p>Hi {{name}},</p>
<p>Write your message here.</p>
<p>Thanks,<br>The team</p>`;

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const STATUS_BADGE: Record<JobSummary["status"], string> = {
  scheduled: "bg-amber-50 text-amber-800",
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
    "email,name,status,error,sent_at,opened_at,open_count,clicked_at,click_count,clicked_links,delivery_issue",
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
        r.deliveryIssue ?? "",
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

export default function BulkEmailPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const segment = pathname.split("/")[2] as Tab | undefined;
  const tab: Tab = segment && TABS.includes(segment) ? segment : "overview";
  const setTab = (t: Tab) => router.push(`/email-marketing/${t}`);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Compose state
  const [fromDomain, setFromDomain] = useState("");
  const [fromLocalPart, setFromLocalPart] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [savingTemplateName, setSavingTemplateName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showListPicker, setShowListPicker] = useState(false);
  const [savingListName, setSavingListName] = useState<string | null>(null);
  const [bodyHtml, setBodyHtml] = useState(DEFAULT_BODY);
  const [recipientsText, setRecipientsText] = useState("");
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);
  const [utmEnabled, setUtmEnabled] = useState(false);
  const [utmSource, setUtmSource] = useState("email");
  const [utmMedium, setUtmMedium] = useState("email");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [linkResults, setLinkResults] = useState<{ url: string; ok: boolean; status?: number; error?: string }[] | null>(null);
  const [checkingLinks, setCheckingLinks] = useState(false);
  // Link results describe a specific body -- clear them when it changes.
  useEffect(() => setLinkResults(null), [bodyHtml]);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [bodyView, setBodyView] = useState<"visual" | "html" | "preview">("visual");
  const visualEditorEl = useRef<HTMLDivElement | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<string | null>(null);
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

  async function loadTemplates() {
    try {
      setTemplates((await apiGet<{ templates: SavedTemplate[] }>("/api/email/templates")).templates);
    } catch {
      // Templates are optional -- Compose works without them.
    }
  }

  useEffect(() => {
    refresh();
    loadTemplates();
    // Restore an unsent draft from this browser, if there is one.
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const draft = JSON.parse(saved) as ComposeDraft;
        if (draft.subject || draft.recipientsText || (draft.bodyHtml && draft.bodyHtml !== DEFAULT_BODY)) {
          applyDraft(draft);
          setDraftRestored(true);
        }
      }
    } catch {
      // Storage unavailable or corrupt -- start blank.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave the draft in this browser so a refresh or closed tab doesn't
  // lose work. Large recipient lists are skipped to stay within storage.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const draft: ComposeDraft = {
          fromName,
          replyTo,
          subject,
          preheader,
          bodyHtml,
          recipientsText: recipientsText.length < 400_000 ? recipientsText : "",
          trackOpens,
          trackClicks,
        };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch {
        // Storage full or unavailable -- autosave is best-effort.
      }
    }, 500);
    return () => clearTimeout(t);
  }, [fromName, replyTo, subject, preheader, bodyHtml, recipientsText, trackOpens, trackClicks]);

  function applyDraft(d: ComposeDraft) {
    if (d.fromDomain) setFromDomain(d.fromDomain);
    if (d.fromLocalPart) setFromLocalPart(d.fromLocalPart);
    if (d.fromName !== undefined) setFromName(d.fromName);
    if (d.replyTo !== undefined) setReplyTo(d.replyTo);
    if (d.subject !== undefined) setSubject(d.subject);
    if (d.preheader !== undefined) setPreheader(d.preheader);
    if (d.bodyHtml !== undefined) setBodyHtml(d.bodyHtml);
    if (d.recipientsText !== undefined) setRecipientsText(d.recipientsText);
    if (d.trackOpens !== undefined) setTrackOpens(d.trackOpens);
    if (d.trackClicks !== undefined) setTrackClicks(d.trackClicks);
    if (d.utm !== undefined) {
      setUtmEnabled(!!d.utm);
      if (d.utm) {
        setUtmSource(d.utm.source);
        setUtmMedium(d.utm.medium);
        setUtmCampaign(d.utm.campaign);
      }
    }
  }

  function clearCompose() {
    setSubject("");
    setPreheader("");
    setBodyHtml(DEFAULT_BODY);
    setRecipientsText("");
    setScheduleMode("now");
    setScheduledLocal("");
    setDraftRestored(false);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function loadIntoCompose(d: ComposeDraft, notice: string) {
    applyDraft(d);
    setBodyView(d.bodyHtml === undefined || isVisualSafe(d.bodyHtml) ? "visual" : "html");
    setConfirming(false);
    setComposeError(null);
    setComposeNotice(notice);
    setDraftRestored(false);
    setTab("compose");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function sendAgain(id: string, audience: SendAgainAudience) {
    try {
      const d = await apiGet<ComposeDraft & { recipients: { email: string; name: string; vars: Record<string, string> }[] }>(
        `/api/email/bulk/${id}?draft=${audience}`
      );
      if (d.recipients.length === 0) {
        setHistoryError("Nobody matches -- everyone in that send already opened/clicked.");
        return;
      }
      const who = audience === "all" ? "all recipients" : audience === "not_opened" ? "people who didn't open" : "people who didn't click";
      loadIntoCompose(
        { ...d, recipientsText: recipientsToCsv(d.recipients) },
        `Loaded "${d.subject}" with ${d.recipients.length.toLocaleString()} ${who}. Review it, then send.`
      );
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "Couldn't load that send.");
    }
  }

  function applyTemplate(t: SavedTemplate) {
    loadIntoCompose(
      { subject: t.subject, preheader: t.preheader ?? "", bodyHtml: t.bodyHtml },
      `Template "${t.name}" loaded. Add recipients, then send.`
    );
  }

  function applyRecipientsCsv(csv: string, notice: string) {
    setRecipientsText(csv);
    setShowListPicker(false);
    setComposeError(null);
    setComposeNotice(notice);
    setTab("compose");
  }

  async function saveRecipientsAsList() {
    if (!savingListName?.trim()) return;
    try {
      const r = await apiPost<{ count: number }>("/api/email/lists", { name: savingListName, text: recipientsText });
      setComposeNotice(`Saved ${r.count.toLocaleString()} contacts as list "${savingListName.trim()}".`);
      setSavingListName(null);
    } catch (err) {
      setComposeError(err instanceof ApiError ? err.message : "Couldn't save the list.");
    }
  }

  async function saveTemplate() {
    if (!savingTemplateName?.trim()) return;
    try {
      await apiPost("/api/email/templates", { name: savingTemplateName, subject, preheader, bodyHtml });
      setComposeNotice(`Saved as template "${savingTemplateName.trim()}".`);
      setSavingTemplateName(null);
      loadTemplates();
    } catch (err) {
      setComposeError(err instanceof ApiError ? err.message : "Couldn't save the template.");
    }
  }

  const anySending = data?.jobs.some((j) => j.status === "sending") ?? false;
  // Opens keep arriving after a send finishes, so an expanded send keeps
  // refreshing too -- just less often.
  const anyScheduled = data?.jobs.some((j) => j.status === "scheduled") ?? false;
  useEffect(() => {
    if (!anySending && !expandedId && !anyScheduled) return;
    const interval = setInterval(
      () => {
        refresh();
        if (expandedId) refreshDetail(expandedId);
      },
      anySending ? 3000 : 30000
    );
    return () => clearInterval(interval);
  }, [anySending, expandedId, anyScheduled]);

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
  const previewHtml = renderTemplate(withFooter(bodyHtml, data?.settings.postalAddress), previewVars, { html: true });
  const previewSubject = renderTemplate(subject, previewVars, { html: false });

  const tooMany = parsed.recipients.length > MAX_RECIPIENTS_PER_JOB;
  const canSend = data?.canSend ?? false;
  const noSenders = data !== null && data.senders.length === 0;
  const visualSafe = isVisualSafe(bodyHtml);
  const findings = useMemo(
    () =>
      runPresendChecks({
        subject,
        preheader,
        bodyHtml,
        renderedHtml: previewHtml,
        unknownTags,
        recipientCount: parsed.recipients.length,
      }),
    [subject, preheader, bodyHtml, previewHtml, unknownTags, parsed.recipients.length]
  );
  const brokenLinks = linkResults?.filter((r) => !r.ok) ?? [];

  async function checkDraftLinks() {
    setCheckingLinks(true);
    try {
      const urls = extractLinks(bodyHtml).filter((u) => /^https?:\/\//i.test(u) && !u.includes("{{"));
      const res = await apiPost<{ results: { url: string; ok: boolean; status?: number; error?: string }[] }>(
        "/api/email/bulk/check-links",
        { urls: urls.slice(0, 40) }
      );
      setLinkResults(res.results);
    } catch (err) {
      setComposeError(err instanceof ApiError ? err.message : "Couldn't check links.");
    } finally {
      setCheckingLinks(false);
    }
  }
  const missingAddress = data !== null && !data.settings.postalAddress;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRecipientsText(await file.text());
    e.target.value = "";
  }

  function insertTag(tag: string) {
    if (bodyView === "visual" && insertTextAtCaret(visualEditorEl.current, `{{${tag}}}`)) return;
    setBodyHtml((b) => b + `{{${tag}}}`);
    if (bodyView === "preview") setBodyView(visualSafe ? "visual" : "html");
  }

  function draftPayload() {
    return {
      fromDomain,
      fromLocalPart,
      fromName,
      replyTo,
      subject,
      preheader,
      bodyHtml,
      utm: utmEnabled ? { source: utmSource, medium: utmMedium, campaign: utmCampaign || campaignSlug(subject) } : undefined,
    };
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
    let createdId: string | null = null;
    try {
      // 1. Create the send, 2. upload recipients in batches (keeps every
      // request small, whatever the list size), 3. start it.
      const created = await apiPost<{ id: string }>("/api/email/bulk", {
        ...draftPayload(),
        trackOpens,
        trackClicks,
        scheduledAt: scheduleMode === "later" && scheduledLocal ? new Date(scheduledLocal).toISOString() : undefined,
      });
      createdId = created.id;
      const all = parsed.recipients;
      for (let i = 0; i < all.length; i += UPLOAD_BATCH) {
        setSendProgress(`Uploading recipients… ${Math.min(i + UPLOAD_BATCH, all.length).toLocaleString()} of ${all.length.toLocaleString()}`);
        await apiPost(`/api/email/bulk/${created.id}/recipients`, { recipients: all.slice(i, i + UPLOAD_BATCH) });
      }
      setSendProgress("Starting…");
      await apiPatch(`/api/email/bulk/${created.id}`, { action: "start" });
      setConfirming(false);
      clearCompose();
      await refresh();
      setTab("history");
      setExpandedId(created.id);
      refreshDetail(created.id);
    } catch (err) {
      // Don't leave a half-uploaded send behind.
      if (createdId) apiPatch(`/api/email/bulk/${createdId}`, { action: "cancel" }).catch(() => {});
      setComposeError(err instanceof ApiError ? err.message : "Failed to start the send.");
      setConfirming(false);
    } finally {
      setSending(false);
      setSendProgress(null);
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
    (scheduleMode === "now" || !!scheduledLocal) &&
    !tooMany &&
    !missingAddress;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Page header */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Email Marketing</p>
        <h1 className="mt-1 font-serif text-2xl font-bold text-slate-900">
          {TAB_HEADING[tab].title}
          {tab === "history" && anySending && (
            <span className="ml-2 align-middle text-xs font-medium text-indigo-600">sending…</span>
          )}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{TAB_HEADING[tab].subtitle}</p>
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
          {missingAddress && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Add your business postal address before sending -- anti-spam laws require it in marketing email.{" "}
                <button onClick={() => setTab("settings")} className="font-medium underline">
                  Open Settings
                </button>
              </span>
            </div>
          )}
          {data && !canSend && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Your role can view bulk sends but not send them. Ask a manager, admin, or owner.
            </div>
          )}

          {(draftRestored || templates.length > 0) && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {draftRestored && (
                <span className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-indigo-800">
                  Restored your unsent draft.
                  <button onClick={clearCompose} className="font-medium underline">
                    Start fresh
                  </button>
                </span>
              )}
              {templates.length > 0 && (
                <label className="ml-auto flex items-center gap-2 text-slate-600">
                  <FileText size={15} />
                  <select
                    value=""
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value);
                      if (t) applyTemplate(t);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="">Load a template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                {fromDomain && (
                  <div className="mt-2">
                    <DomainHealth domain={fromDomain} compact />
                  </div>
                )}
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
              <div className="ml-auto mr-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowListPicker((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Users size={14} />
                  Use a saved list
                </button>
                {canSend && parsed.recipients.length > 0 && savingListName === null && (
                  <button
                    type="button"
                    onClick={() => setSavingListName("")}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Save size={14} />
                    Save as list
                  </button>
                )}
              </div>
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
            {showListPicker && <ListPicker onLoad={applyRecipientsCsv} onClose={() => setShowListPicker(false)} />}
            {savingListName !== null && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={savingListName}
                  onChange={(e) => setSavingListName(e.target.value)}
                  placeholder="List name"
                  autoFocus
                  className={inputClass + " w-56"}
                />
                <button
                  type="button"
                  onClick={saveRecipientsAsList}
                  disabled={!savingListName.trim()}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Save list
                </button>
                <button type="button" onClick={() => setSavingListName(null)} className="text-sm text-slate-500 hover:text-slate-900">
                  Cancel
                </button>
              </div>
            )}
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
                <label className={labelClass}>Preview text (optional)</label>
                <input
                  value={preheader}
                  onChange={(e) => setPreheader(e.target.value)}
                  maxLength={300}
                  placeholder="The short line shown after the subject in the inbox"
                  className={inputClass}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className={labelClass + " mb-0"}>Body</label>
                  <div className="flex gap-1">
                    {(
                      [
                        ["visual", "Visual", Pencil],
                        ["html", "HTML", Code2],
                        ["preview", "Preview", Eye],
                      ] as const
                    ).map(([mode, label, Icon]) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={mode === "visual" && !visualSafe}
                        title={
                          mode === "visual" && !visualSafe
                            ? "This HTML uses styles or code the visual editor can't safely show -- edit it in HTML mode."
                            : undefined
                        }
                        onClick={() => setBodyView(mode)}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${bodyView === mode ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500"}`}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                {bodyView === "visual" && visualSafe ? (
                  <VisualEditor value={bodyHtml} onChange={setBodyHtml} editorRef={visualEditorEl} />
                ) : bodyView !== "preview" ? (
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
                      {preheader && (
                        <p>
                          <span className="text-slate-400">Preview text:</span>{" "}
                          {renderTemplate(preheader, previewVars, { html: false })}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-end gap-1 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                      {(["desktop", "mobile"] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setPreviewDevice(d)}
                          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${previewDevice === d ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500"}`}
                        >
                          {d === "desktop" ? <Monitor size={13} /> : <Smartphone size={13} />}
                          {d === "desktop" ? "Desktop" : "Mobile"}
                        </button>
                      ))}
                    </div>
                    <div className={previewDevice === "mobile" ? "flex justify-center bg-slate-100 py-4" : ""}>
                      <iframe
                        title="Email preview"
                        sandbox=""
                        srcDoc={previewHtml}
                        className={
                          previewDevice === "mobile"
                            ? "h-[560px] w-[375px] rounded-2xl border-4 border-slate-800 bg-white shadow-lg"
                            : "h-80 w-full bg-white"
                        }
                      />
                    </div>
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
              <div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={utmEnabled}
                    onChange={(e) => setUtmEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                  />
                  Add campaign tags to links
                  <span className="text-xs text-slate-400">(UTM tags, so Google Analytics shows which email brought each visitor)</span>
                </label>
                {utmEnabled && (
                  <div className="mt-2 grid grid-cols-1 gap-2 pl-6 sm:grid-cols-3">
                    <div>
                      <label className={labelClass}>utm_source</label>
                      <input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>utm_medium</label>
                      <input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>utm_campaign</label>
                      <input
                        value={utmCampaign}
                        onChange={(e) => setUtmCampaign(e.target.value)}
                        placeholder={campaignSlug(subject) || "spring-sale"}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-400">
                An unsubscribe link is added automatically unless you place {"{{unsubscribe_url}}"} yourself.
                Unsubscribed addresses are skipped on future sends.
              </p>
            </div>
          </div>

          {/* Pre-send checklist */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Pre-send check
                {findings.length === 0 && brokenLinks.length === 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 size={13} /> Looks good
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={checkDraftLinks}
                disabled={checkingLinks || !canSend || extractLinks(bodyHtml).length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {checkingLinks ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                {linkResults ? "Re-check links" : "Check links"}
              </button>
            </div>
            {(findings.length > 0 || linkResults) && (
              <ul className="mt-3 space-y-1.5 text-sm">
                {findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {f.level === "error" ? (
                      <XCircle size={15} className="mt-0.5 shrink-0 text-red-500" aria-label="Problem" />
                    ) : f.level === "warning" ? (
                      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-label="Warning" />
                    ) : (
                      <Info size={15} className="mt-0.5 shrink-0 text-slate-400" aria-label="Tip" />
                    )}
                    <span className={f.level === "tip" ? "text-slate-500" : "text-slate-700"}>{f.message}</span>
                  </li>
                ))}
                {linkResults &&
                  (brokenLinks.length === 0 ? (
                    <li className="flex items-start gap-2 text-slate-700">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                      All {linkResults.length} link{linkResults.length === 1 ? "" : "s"} work.
                    </li>
                  ) : (
                    brokenLinks.map((r) => (
                      <li key={r.url} className="flex items-start gap-2">
                        <XCircle size={15} className="mt-0.5 shrink-0 text-red-500" aria-label="Broken link" />
                        <span className="min-w-0 text-slate-700">
                          Broken link{r.status ? ` (${r.status})` : r.error ? ` (${r.error})` : ""}:{" "}
                          <span className="break-all text-slate-500">{r.url}</span>
                        </span>
                      </li>
                    ))
                  ))}
              </ul>
            )}
          </div>

          {/* Save as template + schedule */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {savingTemplateName === null ? (
              <button
                type="button"
                onClick={() => setSavingTemplateName(subject || "")}
                disabled={!canSend || !bodyHtml.trim()}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Save size={15} /> Save as template
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={savingTemplateName}
                  onChange={(e) => setSavingTemplateName(e.target.value)}
                  placeholder="Template name"
                  autoFocus
                  className={inputClass + " w-56"}
                />
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={!savingTemplateName.trim()}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button type="button" onClick={() => setSavingTemplateName(null)} className="text-sm text-slate-500 hover:text-slate-900">
                  Cancel
                </button>
              </div>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <CalendarClock size={15} className="text-slate-400" />
              <label className="flex items-center gap-1">
                <input type="radio" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} className="accent-indigo-600" />
                Send now
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={scheduleMode === "later"}
                  onChange={() => {
                    setScheduleMode("later");
                    if (!scheduledLocal) setScheduledLocal(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
                  }}
                  className="accent-indigo-600"
                />
                Schedule
              </label>
              {scheduleMode === "later" && (
                <input
                  type="datetime-local"
                  value={scheduledLocal}
                  min={toLocalInputValue(new Date())}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                />
              )}
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
                  {findings.some((f) => f.level === "error") || brokenLinks.length > 0 ? (
                    <span className="mr-1 font-medium text-red-600">The pre-send check found problems.</span>
                  ) : null}
                  {scheduleMode === "later" && scheduledLocal
                    ? `Schedule for ${new Date(scheduledLocal).toLocaleString()} to ${parsed.recipients.length.toLocaleString()} recipients?`
                    : `Send to ${parsed.recipients.length.toLocaleString()} recipients?`}
                </span>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {scheduleMode === "later" ? "Yes, schedule" : "Yes, send"}
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
                {scheduleMode === "later" ? <CalendarClock size={15} /> : <Send size={15} />}
                {scheduleMode === "later" ? "Schedule" : "Send to"} {parsed.recipients.length.toLocaleString()}
              </button>
            )}
          </div>
          {sendProgress && (
            <p className="flex items-center gap-2 text-sm text-indigo-700">
              <Loader2 size={14} className="animate-spin" /> {sendProgress}
            </p>
          )}
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
                  <th className="px-3 py-3">From / by</th>
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
                            {job.createdByName && <p className="text-xs text-slate-400">by {job.createdByName}</p>}
                          </td>
                          <td className="min-w-[180px] px-3 py-3">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {job.sent.toLocaleString()} sent
                              {job.failed > 0 && <span className="text-red-600"> · {job.failed} failed</span>}
                              {job.skipped > 0 && <span> · {job.skipped} skipped</span>}
                              {job.bounced > 0 && <span className="text-red-600"> · {job.bounced} bounced</span>}
                              {job.complained > 0 && <span className="text-amber-700"> · {job.complained} spam</span>} /{" "}
                              {job.total.toLocaleString()}
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
                            {job.status === "scheduled" && job.scheduledAt && (
                              <p className="mt-1 whitespace-nowrap text-xs text-amber-700">{formatDate(job.scheduledAt)}</p>
                            )}
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
                                onSendAgain={(audience) => sendAgain(job.id, audience)}
                                onOpenContact={setProfileEmail}
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

      {tab === "overview" && <OverviewTab />}
      {tab === "forms" && <FormsTab senders={data?.senders ?? []} />}
      {tab === "lists" && <ListsTab onUse={applyRecipientsCsv} onOpenContact={setProfileEmail} />}
      {tab === "templates" && <TemplatesTab onUse={applyTemplate} />}
      {tab === "unsubscribes" && <UnsubscribesTab onOpenContact={setProfileEmail} />}
      {profileEmail && <ContactProfile email={profileEmail} onClose={() => setProfileEmail(null)} />}
      {tab === "settings" && <SettingsTab onSaved={refresh} />}
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
  onSendAgain,
  onOpenContact,
}: {
  job: JobSummary;
  detail: JobDetail | null;
  canManage: boolean;
  filter: RecipientFilter;
  onFilter: (f: RecipientFilter) => void;
  actionPending: string | null;
  onAction: (action: "cancel" | "resume" | "retry_failed") => void;
  onRefresh: () => void;
  onSendAgain: (audience: SendAgainAudience) => void;
  onOpenContact: (email: string) => void;
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
    ...(detail.recipients.some((r) => r.deliveryIssue) ? (["bounced"] as const) : []),
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
        {job.status === "scheduled" && job.scheduledAt && (
          <span className="text-xs text-amber-700">Scheduled for {formatDate(job.scheduledAt)}</span>
        )}
        {job.completedAt && job.status !== "cancelled" && (
          <span className="text-xs text-slate-500">Finished {formatDate(job.completedAt)}</span>
        )}
        {job.error && <span className="text-xs text-red-600">Error: {job.error}</span>}
        <div className="ml-auto flex gap-2">
          {canManage && (job.status === "sending" || job.status === "scheduled") && (
            <button
              onClick={() => onAction("cancel")}
              disabled={busy("cancel")}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Ban size={13} /> {job.status === "scheduled" ? "Cancel scheduled send" : "Cancel send"}
            </button>
          )}
          {canManage && job.status !== "sending" && job.status !== "scheduled" && pending > 0 && (
            <button
              onClick={() => onAction("resume")}
              disabled={busy("resume")}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Send size={13} /> Resume ({pending} left)
            </button>
          )}
          {canManage && job.status !== "sending" && job.status !== "scheduled" && job.failed > 0 && (
            <button
              onClick={() => onAction("retry_failed")}
              disabled={busy("retry_failed")}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw size={13} /> Retry {job.failed} failed
            </button>
          )}
          {canManage && (
            <select
              value=""
              onChange={(e) => e.target.value && onSendAgain(e.target.value as SendAgainAudience)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <option value="">Send again…</option>
              <option value="all">To everyone</option>
              {job.trackOpens && <option value="not_opened">To people who didn&apos;t open</option>}
              {job.trackClicks && <option value="not_clicked">To people who didn&apos;t click</option>}
            </select>
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
            {f === "bounced" ? "bounced / spam" : f.replace("_", " ")}
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
                <button onClick={() => onOpenContact(r.email)} className="font-medium text-slate-800 hover:text-indigo-600 hover:underline">
                  {r.email}
                </button>
                {r.name && <span className="text-slate-400">{r.name}</span>}
                {r.openedAt && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700"
                    title={`First opened ${formatDate(r.openedAt)}${r.lastOpenedAt ? ` · last ${formatDate(r.lastOpenedAt)}` : ""}`}
                  >
                    <MailOpen size={12} /> Opened{(r.openCount ?? 0) > 1 ? ` ×${r.openCount}` : ""}
                  </span>
                )}
                {r.deliveryIssue && (
                  <span
                    className={`rounded-full px-2 py-0.5 ${r.deliveryIssue === "complained" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}
                    title={r.deliveryIssueAt ? `Reported ${formatDate(r.deliveryIssueAt)}` : undefined}
                  >
                    {r.deliveryIssue === "bounced" ? "Bounced" : r.deliveryIssue === "soft_bounced" ? "Soft bounce" : "Spam complaint"}
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
