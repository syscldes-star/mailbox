"use client";

// History → a send → "Click map": the email itself with a badge on every
// link showing how many people clicked it, plus the same numbers as a
// ranked list.

import { useEffect, useState } from "react";
import { Loader2, MousePointerClick, X } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";

interface ClickMapData {
  subject: string;
  trackClicks: boolean;
  sent: number;
  clicked: number;
  html: string;
  links: { index: number; href: string; label: string; clickers: number }[];
  other: { url: string; clickers: number }[];
}

export function useClickMap(jobId: string | null) {
  const [data, setData] = useState<ClickMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!jobId) return;
    setData(null);
    setError(null);
    apiGet<ClickMapData>(`/api/email/bulk/${jobId}/clickmap`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load the click map."));
  }, [jobId]);
  return { data, error };
}

export default function ClickMapModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { data, error } = useClickMap(jobId);
  const pct = (n: number) => (data?.sent ? `${Math.round((n / data.sent) * 100)}%` : "—");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
          <MousePointerClick size={18} className="text-indigo-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Click map</p>
            {data && <p className="truncate text-xs text-slate-500">{data.subject}</p>}
          </div>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : !data ? (
          <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_320px]">
            <div className="min-h-[420px] overflow-hidden border-b border-slate-200 bg-slate-100 p-4 lg:border-b-0 lg:border-r">
              <iframe title="Click map" sandbox="allow-popups" srcDoc={data.html} className="h-full min-h-[400px] w-full rounded-lg bg-white shadow" />
            </div>
            <div className="overflow-y-auto p-4">
              {!data.trackClicks && (
                <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Click tracking was off for this send, so no clicks were recorded.</p>
              )}
              <p className="text-xs text-slate-500">
                {data.clicked.toLocaleString()} of {data.sent.toLocaleString()} people clicked at least one link ({pct(data.clicked)}).
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" /> most</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" /> more</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400" /> some</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-slate-200" /> none</span>
              </div>
              <ol className="mt-3 space-y-2">
                {[...data.links]
                  .sort((a, b) => b.clickers - a.clickers || a.index - b.index)
                  .map((l) => (
                    <li key={l.index} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800" title={l.label}>
                          {l.label}
                        </p>
                        <span className="shrink-0 text-sm font-semibold text-slate-900">{l.clickers}</span>
                      </div>
                      <p className="truncate text-xs text-slate-400" title={l.href}>
                        {l.href}
                      </p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-indigo-500" style={{ width: data.sent ? `${Math.min(100, (l.clickers / data.sent) * 100)}%` : 0 }} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{pct(l.clickers)} of people delivered to</p>
                    </li>
                  ))}
                {data.links.length === 0 && <li className="text-sm text-slate-500">This email has no links.</li>}
              </ol>
              {data.other.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-slate-600">Other links clicked</p>
                  <ul className="mt-1 space-y-1 text-xs text-slate-500">
                    {data.other.map((o) => (
                      <li key={o.url} className="flex gap-2">
                        <span className="truncate" title={o.url}>{o.url}</span>
                        <span className="ml-auto shrink-0">{o.clickers}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
