"use client";

// "Use a saved list" panel in Compose: pick a contact list, optionally
// narrow it to a segment, then load the matching contacts as recipients.

import { useEffect, useMemo, useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { apiGet, ApiError } from "@/lib/api/client";
import { recipientsToCsv } from "@/lib/bulk-email/recipients";
import { filterContacts, SEGMENT_OPS, type SegmentCondition } from "@/lib/bulk-email/segments";
import { inputClass, labelClass, secondaryButton } from "./ui";

interface ListSummary {
  id: string;
  name: string;
  count: number;
}

interface FullList {
  id: string;
  name: string;
  columns: string[];
  contacts: { email: string; name?: string; vars?: Record<string, string> }[];
}

export default function ListPicker({ onLoad, onClose }: { onLoad: (csv: string, notice: string) => void; onClose: () => void }) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [selected, setSelected] = useState<FullList | null>(null);
  const [loading, setLoading] = useState(false);
  const [conditions, setConditions] = useState<SegmentCondition[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ lists: ListSummary[] }>("/api/email/lists")
      .then((r) => setLists(r.lists))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load lists."));
  }, []);

  async function pick(id: string) {
    setSelected(null);
    setConditions([]);
    if (!id) return;
    setLoading(true);
    try {
      setSelected(await apiGet<FullList>(`/api/email/lists/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load that list.");
    } finally {
      setLoading(false);
    }
  }

  const matching = useMemo(
    () => (selected ? filterContacts(selected.contacts, conditions, match) : []),
    [selected, conditions, match]
  );

  function updateCondition(i: number, patch: Partial<SegmentCondition>) {
    setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">Use a saved list</p>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
          <X size={15} />
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {lists && lists.length === 0 ? (
        <p className="text-xs text-slate-500">No saved lists yet -- create one in the Lists tab, or use “Save as list” below.</p>
      ) : (
        <div>
          <label className={labelClass}>List</label>
          <select onChange={(e) => pick(e.target.value)} defaultValue="" className={inputClass + " bg-white"}>
            <option value="">Choose a list…</option>
            {lists?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.count.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}
      {loading && <Loader2 size={16} className="animate-spin text-indigo-500" />}

      {selected && (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              Only include contacts matching
              <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className="rounded border border-slate-200 bg-white px-1 py-0.5">
                <option value="all">all</option>
                <option value="any">any</option>
              </select>
              of these conditions (optional):
            </div>
            {conditions.map((c, i) => {
              const needsValue = SEGMENT_OPS.find((o) => o.op === c.op)?.needsValue ?? true;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select value={c.column} onChange={(e) => updateCondition(i, { column: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                    {selected.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <select value={c.op} onChange={(e) => updateCondition(i, { op: e.target.value as SegmentCondition["op"] })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                    {SEGMENT_OPS.map((o) => (
                      <option key={o.op} value={o.op}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {needsValue && (
                    <input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="value" className="w-40 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" />
                  )}
                  <button onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="Remove condition">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setConditions((cs) => [...cs, { column: selected.columns[0] ?? "email", op: "equals", value: "" }])}
              className={secondaryButton}
            >
              <Plus size={13} /> Add condition
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                onLoad(
                  recipientsToCsv(matching),
                  `Loaded ${matching.length.toLocaleString()} contacts from "${selected.name}"${conditions.length ? " (filtered)" : ""}.`
                )
              }
              disabled={matching.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Use {matching.length.toLocaleString()} contact{matching.length === 1 ? "" : "s"}
            </button>
            <span className="text-xs text-slate-500">of {selected.contacts.length.toLocaleString()} in the list</span>
          </div>
        </>
      )}
    </div>
  );
}
