"use client";

import { useEffect, useState } from "react";
import { FileText, Pencil, Trash2, Check, X, Send } from "lucide-react";
import { apiDelete, apiGet, apiPut, ApiError } from "@/lib/api/client";
import { CreatedBy, ShareButton, type CreatorInfo } from "./Sharing";
import { cardClass, formatDate, inputClass, secondaryButton } from "./ui";

export interface SavedTemplate {
  id: string;
  name: string;
  subject: string;
  preheader?: string;
  bodyHtml: string;
  updatedAt: string;
  createdByInfo?: CreatorInfo;
  sharedWith?: string[];
}

export default function TemplatesTab({ onUse }: { onUse: (template: SavedTemplate) => void }) {
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiGet<{ templates: SavedTemplate[]; canManage: boolean; isOwner?: boolean }>("/api/email/templates");
      setTemplates(res.templates);
      setCanManage(res.canManage);
      setIsOwner(!!res.isOwner);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load templates.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function rename(id: string) {
    try {
      await apiPut(`/api/email/templates/${id}`, { name: renameValue });
      setRenamingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rename failed.");
    }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/api/email/templates/${id}`);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed.");
    }
  }

  if (!templates) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-400">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {templates.length === 0 ? (
        <div className={cardClass + " text-center"}>
          <FileText size={22} className="mx-auto text-slate-300" />
          <p className="mt-2 text-sm text-slate-600">No saved templates yet.</p>
          <p className="mt-1 text-xs text-slate-400">
            In Compose, write a message and click <strong>Save as template</strong> to reuse it later.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className={cardClass + " flex flex-col"}>
              <div className="flex items-start justify-between gap-2">
                {renamingId === t.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className={inputClass} autoFocus />
                    <button onClick={() => rename(t.id)} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50">
                      <Check size={15} />
                    </button>
                    <button onClick={() => setRenamingId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="font-serif text-base font-bold text-slate-900">{t.name}</p>
                    <CreatedBy info={t.createdByInfo} sharedCount={t.sharedWith?.length} />
                  </div>
                )}
                {canManage && renamingId !== t.id && (
                  <div className="flex shrink-0 gap-1">
                    {isOwner && (
                      <ShareButton
                        kind="templates"
                        id={t.id}
                        name={t.name}
                        sharedWith={t.sharedWith ?? []}
                        creatorId={t.createdByInfo?.id ?? null}
                        onSaved={(ids) => setTemplates((list) => list && list.map((x) => (x.id === t.id ? { ...x, sharedWith: ids } : x)))}
                      />
                    )}
                    <button
                      onClick={() => {
                        setRenamingId(t.id);
                        setRenameValue(t.name);
                      }}
                      title="Rename"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(t.id)}
                      title="Delete"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-slate-700">{t.subject || <em className="text-slate-400">No subject</em>}</p>
              {t.preheader && <p className="truncate text-xs text-slate-400">{t.preheader}</p>}
              <p className="mt-1 text-xs text-slate-400">Updated {formatDate(t.updatedAt)}</p>

              {previewId === t.id && (
                <iframe title={`Preview of ${t.name}`} sandbox="" srcDoc={t.bodyHtml} className="mt-3 h-64 w-full rounded-lg border border-slate-200 bg-white" />
              )}

              {confirmDeleteId === t.id ? (
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="text-slate-700">Delete this template?</span>
                  <button onClick={() => remove(t.id)} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">
                    Delete
                  </button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-slate-500 hover:text-slate-900">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-auto flex gap-2 pt-3">
                  <button onClick={() => onUse(t)} className={secondaryButton}>
                    <Send size={13} /> Use in Compose
                  </button>
                  <button onClick={() => setPreviewId(previewId === t.id ? null : t.id)} className={secondaryButton}>
                    {previewId === t.id ? "Hide preview" : "Preview"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
