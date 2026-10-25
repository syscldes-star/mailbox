"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Circle, KeyRound, Copy, Plus, Search, Clock, RefreshCw, Route } from "lucide-react";
import DnsRecords from "@/components/bulk-email/DnsRecords";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import type { ProvisioningState, StepStatus } from "@/lib/email-provisioning/types";
import DomainHealth from "@/components/bulk-email/DomainHealth";

const STEP_LABELS: Record<string, string> = {
  ownership_verified: "Domain ownership verified",
  oracle_email_domain: "Oracle email domain",
  oracle_dkim_create: "DKIM key created",
  dns_dkim_cname: "DKIM DNS record published",
  dns_mail_records: "MX / SPF / DMARC published",
  oracle_dkim_active: "DKIM verified active",
  oracle_sender: "Approved sender",
  mailcow_domain: "Mailcow domain",
  mailcow_mailbox: "Default mailbox",
  oracle_return_path: "Return path created",
  dns_return_path: "Return path DNS record",
  return_path_active: "Return path active",
};

const RETURN_PATH_STEPS = ["oracle_return_path", "dns_return_path", "return_path_active"] as const;

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={15} className="text-emerald-500" />;
  if (status === "failed") return <XCircle size={15} className="text-red-500" />;
  if (status === "in_progress") return <Loader2 size={15} className="animate-spin text-indigo-500" />;
  if (status === "waiting") return <Clock size={15} className="text-amber-500" />;
  return <Circle size={15} className="text-slate-300" />;
}

export default function DomainsPage() {
  const [states, setStates] = useState<ProvisioningState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [domain, setDomain] = useState("");
  const [mailboxLocalPart, setMailboxLocalPart] = useState("hello");
  const [submitting, setSubmitting] = useState(false);

  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [healthOpen, setHealthOpen] = useState<Record<string, boolean>>({});
  const [dnsOpen, setDnsOpen] = useState<Record<string, boolean>>({});
  const [checkKey, setCheckKey] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function domainAction(d: string, action: "check" | "return_path") {
    setBusy(d + action);
    setError(null);
    try {
      await apiPost(`/api/email/domains/${encodeURIComponent(d)}`, { action });
      setCheckKey((k) => ({ ...k, [d]: (k[d] ?? 0) + 1 }));
      setTimeout(refresh, 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    try {
      const data = await apiGet<ProvisioningState[]>("/api/email/domains");
      setStates(data);
      const newlyRevealed = data.filter((s) => s.defaultMailboxPassword);
      if (newlyRevealed.length > 0) {
        setRevealedPasswords((prev) => {
          const next = { ...prev };
          for (const s of newlyRevealed) next[s.domain] = s.defaultMailboxPassword;
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load domains.");
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ dnsMode: "vercel" | "manual"; domain: string }>("/api/email/domains", {
        domain,
        defaultMailboxLocalPart: mailboxLocalPart,
      });
      if (res.dnsMode === "manual") {
        setDnsOpen((o) => ({ ...o, [res.domain]: true }));
        setNotice(
          `${res.domain} added. Add the DNS records shown on its card at your domain provider (GoDaddy, Hostinger…) -- setup carries on by itself once they're found.`
        );
      }
      setDomain("");
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start provisioning.");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = (states ?? []).filter((s) => s.domain.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-slate-900">Email Domains</h1>
          <p className="mt-1 text-sm text-slate-500">
            Set up webmail for any domain. Your site&apos;s domains are configured automatically; for other domains we show the DNS
            records to add.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <Plus size={16} />
          Provision Domain
        </button>
      </div>

      {/* Provision form, toggled */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Domain</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="customerdomain.com"
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-slate-500">Default mailbox</label>
            <input
              value={mailboxLocalPart}
              onChange={(e) => setMailboxLocalPart(e.target.value)}
              placeholder="hello"
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Provision"}
          </button>
        </form>
      )}

      {/* Search row */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <Search size={16} className="text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search domains..."
          className="w-full text-sm outline-none placeholder:text-slate-400"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">{notice}</p>}

      {/* Domain cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {states === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400">No domains found.</p>
        ) : (
          filtered.map((state) => {
            const password = revealedPasswords[state.domain];
            const mailboxAddress = `${state.defaultMailboxLocalPart}@${state.domain}`;
            const coreSteps = Object.entries(state.steps).filter(([k]) => !(RETURN_PATH_STEPS as readonly string[]).includes(k));
            const allDone = coreSteps.every(([, s]) => s === "done");
            const waiting = Object.values(state.steps).some((s) => s === "waiting");
            const failed = Object.values(state.steps).some((s) => s === "failed");
            const manual = state.dnsMode === "manual";
            const returnPathDone = RETURN_PATH_STEPS.every((k) => state.steps[k] === "done");
            const returnPathStarted = RETURN_PATH_STEPS.some((k) => state.steps[k] && state.steps[k] !== "pending");
            const showDns = dnsOpen[state.domain] ?? (manual && !allDone);
            return (
              <div
                key={state.domain}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-serif text-base font-bold text-slate-900">{state.domain}</p>
                  <span
                    className={
                      allDone
                        ? "rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
                        : "rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                    }
                  >
                    {allDone ? "Ready" : waiting ? "Waiting for DNS" : failed ? "Needs attention" : "Provisioning"}
                  </span>
                </div>

                {password && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-amber-800">
                      <KeyRound size={14} />
                      Save this password now — it won't be shown again
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-slate-700">
                        {mailboxAddress} : {password}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(password)}
                        className="rounded-lg border border-amber-300 bg-white p-1.5 text-amber-700 hover:bg-amber-100"
                        title="Copy password"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(STEP_LABELS) as (keyof typeof STEP_LABELS)[])
                    .filter((step) => step !== "ownership_verified" || manual)
                    .filter((step) => !(RETURN_PATH_STEPS as readonly string[]).includes(step) || returnPathStarted)
                    .map((step) => (
                    <div key={step} className="flex items-center gap-2 text-xs text-slate-600">
                      <StepIcon status={state.steps[step as keyof typeof state.steps]} />
                      {STEP_LABELS[step]}
                    </div>
                  ))}
                </div>

                {Object.entries(state.errors || {}).length > 0 && (
                  <div className="mt-3 space-y-1">
                    {Object.entries(state.errors).map(([step, msg]) => {
                      const isWaiting = state.steps[step as keyof typeof state.steps] === "waiting";
                      return (
                        <p key={step} className={`rounded-lg p-2 text-xs ${isWaiting ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-600"}`}>
                          {STEP_LABELS[step] ?? step}: {msg}
                        </p>
                      );
                    })}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {(waiting || failed) && (
                    <button
                      onClick={() => domainAction(state.domain, "check")}
                      disabled={busy === state.domain + "check"}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={busy === state.domain + "check" ? "animate-spin" : ""} />
                      {failed ? "Retry" : "Check now"}
                    </button>
                  )}
                  {allDone && !returnPathStarted && (
                    <button
                      onClick={() => domainAction(state.domain, "return_path")}
                      disabled={busy === state.domain + "return_path"}
                      title="Makes Gmail show 'mailed-by' your domain instead of Oracle's"
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Route size={12} /> Set up return path
                    </button>
                  )}
                  <button
                    onClick={() => setDnsOpen((o) => ({ ...o, [state.domain]: !showDns }))}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {showDns ? "Hide DNS records" : manual ? "DNS records to add" : "DNS records"}
                  </button>
                </div>

                {showDns && (
                  <div className="mt-3">
                    {manual && !allDone && (
                      <p className="mb-2 text-xs text-slate-600">
                        Add these at your domain&apos;s DNS provider. We check every few minutes and continue setup on our own once
                        they&apos;re found (DNS changes can take up to an hour to show).
                      </p>
                    )}
                    <DnsRecords domain={state.domain} refreshKey={checkKey[state.domain]} />
                  </div>
                )}

                {allDone && returnPathDone === false && returnPathStarted && !waiting && !failed && (
                  <p className="mt-2 text-xs text-slate-500">Setting up the return path…</p>
                )}

                {allDone && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <button
                      onClick={() => setHealthOpen((h) => ({ ...h, [state.domain]: !h[state.domain] }))}
                      className="text-xs font-medium text-indigo-600 hover:underline"
                    >
                      {healthOpen[state.domain] ? "Hide email health" : "Check email health (DNS)"}
                    </button>
                    {healthOpen[state.domain] && (
                      <div className="mt-2">
                        <DomainHealth domain={state.domain} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
