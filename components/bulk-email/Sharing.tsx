"use client";

import { useEffect, useState } from "react";
import { UserRound, Users, X } from "lucide-react";
import { ApiError, apiGet, apiPut } from "@/lib/api/client";

/** Who made something, as the API reports it (lib/visibility.ts). */
export interface CreatorInfo {
  id: string | null;
  name: string;
  isYou: boolean;
}

export type ShareKind = "campaigns" | "templates" | "lists" | "forms";

/** "by Ravi K" / "by you", plus how many people it's shared with. */
export function CreatedBy({ info, sharedCount = 0 }: { info?: CreatorInfo; sharedCount?: number }) {
  if (!info) return null;
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1">
        <UserRound size={11} aria-hidden="true" />
        by <span className="font-medium text-slate-600">{info.isYou ? "you" : info.name}</span>
      </span>
      {sharedCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-px text-[11px] font-medium text-indigo-700">
          <Users size={10} aria-hidden="true" /> shared with {sharedCount}
        </span>
      )}
    </p>
  );
}

interface Member {
  userId: string;
  name: string;
  email: string;
}

/** Owner-only "Share" button: choose which team members can see and use
 * this campaign / template / list / form. */
export function ShareButton({
  kind,
  id,
  name,
  sharedWith,
  creatorId,
  onSaved,
}: {
  kind: ShareKind;
  id: string;
  name: string;
  sharedWith: string[];
  creatorId: string | null;
  onSaved: (sharedWith: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
      >
        <Users size={13} aria-hidden="true" /> Share
      </button>
      {open && (
        <ShareDialog
          kind={kind}
          id={id}
          name={name}
          sharedWith={sharedWith}
          creatorId={creatorId}
          onClose={() => setOpen(false)}
          onSaved={(ids) => {
            onSaved(ids);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

const KIND_LABEL: Record<ShareKind, string> = {
  campaigns: "campaign (with its emails and drafts)",
  templates: "template",
  lists: "list (with its contacts)",
  forms: "signup form",
};

function ShareDialog({
  kind,
  id,
  name,
  sharedWith,
  creatorId,
  onClose,
  onSaved,
}: {
  kind: ShareKind;
  id: string;
  name: string;
  sharedWith: string[];
  creatorId: string | null;
  onClose: () => void;
  onSaved: (sharedWith: string[]) => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selected, setSelected] = useState<string[]>(sharedWith);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<Member[]>("/api/email/team")
      .then(setMembers)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load your team."));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiPut<{ sharedWith: string[] }>(`/api/email/share/${kind}/${id}`, { userIds: selected });
      onSaved(res.sharedWith);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update sharing.");
    } finally {
      setSaving(false);
    }
  }

  // Whoever created it always sees it.
  const choices = (members ?? []).filter((m) => m.userId !== creatorId);

  // Fixed overlay rendered in place (it stops clicks from reaching the row
  // it sits in).
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="share-title" className="truncate text-lg font-semibold text-slate-900">
              Share &ldquo;{name}&rdquo;
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose who on your team can see and use this {KIND_LABEL[kind]}. Others won&apos;t see it.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 max-h-72 space-y-1 overflow-y-auto">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!members && !error && <p className="text-sm text-slate-400">Loading team...</p>}
          {members && choices.length === 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              <Users size={18} className="shrink-0" /> No other team members have the Email panel yet.
            </div>
          )}
          {choices.map((m) => (
            <label key={m.userId} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected.includes(m.userId)}
                onChange={() => setSelected((l) => (l.includes(m.userId) ? l.filter((x) => x !== m.userId) : [...l, m.userId]))}
                className="h-4 w-4 accent-indigo-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{m.name}</span>
                <span className="block truncate text-xs text-slate-500">{m.email}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !members}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
