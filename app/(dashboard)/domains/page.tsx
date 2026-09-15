"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Circle, KeyRound, Copy, Plus, Search } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import type { ProvisioningState, StepStatus } from "@/lib/email-provisioning/types";

const STEP_LABELS: Record<string, string> = {
  oracle_email_domain: "Oracle email domain",
  oracle_dkim_create: "DKIM key created",
  dns_dkim_cname: "DKIM DNS record published",
  dns_mail_records: "MX / SPF / DMARC published",
  oracle_dkim_active: "DKIM verified active",
  oracle_sender: "Approved sender",
  mailcow_domain: "Mailcow domain",
  mailcow_mailbox: "Default mailbox",
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle2 size={15} className="text-emerald-500" />;
  if (status === "failed") return <XCircle size={15} className="text-red-500" />;
  if (status === "in_progress") return <Loader2 size={15} className="animate-spin text-indigo-500" />;
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
      await apiPost("/api/email/domains", { domain, defaultMailboxLocalPart: mailboxLocalPart });
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
          <p className="mt-1 text-sm text-slate-500">Provision real webmail for a verified customer domain.</p>
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
            const allDone = Object.values(state.steps).every((s) => s === "done");
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
                    {allDone ? "Ready" : "Provisioning"}
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
                  {(Object.keys(STEP_LABELS) as (keyof typeof STEP_LABELS)[]).map((step) => (
                    <div key={step} className="flex items-center gap-2 text-xs text-slate-600">
                      <StepIcon status={state.steps[step as keyof typeof state.steps]} />
                      {STEP_LABELS[step]}
                    </div>
                  ))}
                </div>

                {Object.entries(state.errors || {}).length > 0 && (
                  <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-600">
                    {Object.entries(state.errors).map(([step, msg]) => (
                      <p key={step}>
                        {STEP_LABELS[step] ?? step}: {msg}
                      </p>
                    ))}
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
