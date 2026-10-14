"use client";

// Live DNS/Oracle health of a sending domain. Full list on the Domains
// page; a one-line summary (expanding to the problems) in Compose.

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";

interface HealthCheck {
  id: string;
  label: string;
  level: "ok" | "warning" | "error";
  detail: string;
}

interface HealthResult {
  domain: string;
  level: "ok" | "warning" | "error";
  checks: HealthCheck[];
  checkedAt: string;
}

// Results are reused for a few minutes so switching the From domain back
// and forth doesn't re-run DNS lookups.
const cache = new Map<string, { at: number; result: HealthResult }>();
const CACHE_MS = 5 * 60 * 1000;

function LevelIcon({ level }: { level: HealthCheck["level"] }) {
  if (level === "ok") return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" aria-label="OK" />;
  if (level === "warning") return <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-label="Warning" />;
  return <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" aria-label="Problem" />;
}

export default function DomainHealth({ domain, compact = false }: { domain: string; compact?: boolean }) {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(force = false) {
    const hit = cache.get(domain);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) {
      setResult(hit.result);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await apiGet<HealthResult>(`/api/email/domain-health?domain=${encodeURIComponent(domain)}`);
      cache.set(domain, { at: Date.now(), result: r });
      setResult(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check the domain.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setResult(null);
    if (domain) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  if (loading && !result) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Loader2 size={13} className="animate-spin" /> Checking {domain}…
      </p>
    );
  }
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!result) return null;

  const problems = result.checks.filter((c) => c.level !== "ok");

  if (compact) {
    if (problems.length === 0) {
      return (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 size={13} /> {domain} is set up correctly for sending.
        </p>
      );
    }
    return (
      <div className={`rounded-lg border p-2.5 text-xs ${result.level === "error" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
        <p className={`font-medium ${result.level === "error" ? "text-red-800" : "text-amber-800"}`}>
          {result.level === "error" ? `${domain} has a setup problem -- emails may go to spam:` : `${domain} could be set up better:`}
        </p>
        <ul className="mt-1 space-y-1">
          {problems.map((c) => (
            <li key={c.id} className="flex items-start gap-1.5 text-slate-700">
              <LevelIcon level={c.level} />
              <span>
                <strong>{c.label}:</strong> {c.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {result.checks.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-xs">
          <LevelIcon level={c.level} />
          <div className="min-w-0">
            <span className="font-medium text-slate-700">{c.label}</span>
            <span className="break-words text-slate-500"> — {c.detail}</span>
          </div>
        </div>
      ))}
      <button onClick={() => run(true)} disabled={loading} className="mt-1 flex items-center gap-1 text-xs text-indigo-600 hover:underline disabled:opacity-50">
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Check again
      </button>
    </div>
  );
}
