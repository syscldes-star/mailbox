"use client";

// The DNS records a domain needs, each checked live -- the "copy these to
// your DNS provider" list for domains whose DNS isn't on Vercel.

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, HelpCircle, Loader2, XCircle } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";

interface Row {
  purpose: string;
  type: string;
  host: string;
  value: string;
  priority?: number;
  required: boolean;
  found: boolean | null;
  note?: string;
}

function CopyValue({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
      className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      title="Copy"
      aria-label={`Copy ${text}`}
    >
      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
    </button>
  );
}

export default function DnsRecords({ domain, refreshKey }: { domain: string; refreshKey?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ records: Row[] }>(`/api/email/domains/${encodeURIComponent(domain)}`)
      .then((r) => setRows(r.records))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load DNS records."));
  }, [domain, refreshKey]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!rows)
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 size={12} className="animate-spin" /> Checking DNS…
      </p>
    );

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={`${r.type}-${r.host}`} className="rounded-lg border border-slate-200 p-2.5 text-xs">
          <div className="flex items-center gap-2">
            {r.found === true ? (
              <CheckCircle2 size={14} className="text-emerald-500" aria-label="Found" />
            ) : r.found === false ? (
              <XCircle size={14} className={r.required ? "text-red-500" : "text-amber-500"} aria-label="Not found yet" />
            ) : (
              <HelpCircle size={14} className="text-slate-400" aria-label="Couldn't check" />
            )}
            <span className="font-medium text-slate-800">{r.purpose}</span>
            <span className="ml-auto text-[11px] text-slate-400">
              {r.found === true ? "found" : r.found === false ? (r.required ? "not found yet" : "recommended") : "couldn't check"}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-[56px_1fr] gap-x-2 gap-y-1">
            <dt className="text-slate-400">Type</dt>
            <dd className="font-mono text-slate-700">
              {r.type}
              {r.priority !== undefined && <span className="ml-2 text-slate-400">priority {r.priority}</span>}
            </dd>
            <dt className="text-slate-400">Host</dt>
            <dd className="flex items-center gap-1 font-mono text-slate-700">
              <span className="break-all">{r.host}</span>
              <CopyValue text={r.host} />
            </dd>
            <dt className="text-slate-400">Value</dt>
            <dd className="flex items-center gap-1 font-mono text-slate-700">
              <span className="break-all">{r.value}</span>
              <CopyValue text={r.value} />
            </dd>
          </dl>
          {r.note && <p className="mt-1.5 text-[11px] text-slate-500">{r.note}</p>}
        </div>
      ))}
    </div>
  );
}
