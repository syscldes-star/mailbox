"use client";

// Contact profile, shown in a dialog from History, Lists and
// Unsubscribes: one person's sends, opens, clicks, lists and
// do-not-email status.

import { useCallback, useEffect, useState } from "react";
import { X, Ban, Loader2, CheckCircle2, MailOpen, MousePointerClick, XCircle } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api/client";
import { formatDate } from "./ui";

interface Profile {
  email: string;
  name: string;
  fields: Record<string, string>;
  suppression: { reason: string; note?: string; since: string } | null;
  lists: { id: string; name: string }[];
  totals: { sent: number; opened: number; clicked: number; lastOpenedAt: string | null };
  sends: {
    jobId: string;
    subject: string;
    createdAt?: string;
    status: string;
    error?: string;
    openedAt?: string;
    openCount: number;
    clickedAt?: string;
    clickCount: number;
    clickedLinks: string[];
    deliveryIssue?: string;
  }[];
  canManage: boolean;
}

const REASON_LABEL: Record<string, string> = {
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complained: "Marked as spam",
  manual: "Added by hand",
};

export default function ContactProfile({ email, onClose }: { email: string; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProfile(await apiGet<Profile>(`/api/email/contacts?email=${encodeURIComponent(email)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this contact.");
    }
  }, [email]);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  async function toggleSuppression() {
    if (!profile) return;
    setBusy(true);
    try {
      if (profile.suppression) await apiDelete(`/api/email/suppressions?email=${encodeURIComponent(profile.email)}`);
      else await apiPost("/api/email/suppressions", { emails: profile.email, note: "From contact profile" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Contact ${email}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-bold text-slate-900">{profile?.name || email}</p>
            {profile?.name && <p className="truncate text-sm text-slate-500">{email}</p>}
            {profile && (
              <p className="mt-1 text-xs">
                {profile.suppression ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                    <Ban size={11} /> {REASON_LABEL[profile.suppression.reason] ?? profile.suppression.reason} · since {formatDate(profile.suppression.since)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                    <CheckCircle2 size={11} /> Can be emailed
                  </span>
                )}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && <p className="px-5 pt-4 text-sm text-red-600">{error}</p>}
        {!profile && !error && (
          <p className="flex items-center gap-2 p-5 text-sm text-slate-400">
            <Loader2 size={15} className="animate-spin" /> Loading…
          </p>
        )}

        {profile && (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ["Emails received", String(profile.totals.sent)],
                ["Opened", `${profile.totals.opened} (${rate(profile.totals.opened, profile.totals.sent)})`],
                ["Clicked", `${profile.totals.clicked} (${rate(profile.totals.clicked, profile.totals.sent)})`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-0.5 font-semibold tabular-nums text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            {(profile.lists.length > 0 || Object.keys(profile.fields).length > 0) && (
              <div className="space-y-2 text-sm">
                {profile.lists.length > 0 && (
                  <p className="text-slate-600">
                    <span className="text-slate-400">Lists: </span>
                    {profile.lists.map((l) => l.name).join(", ")}
                  </p>
                )}
                {Object.entries(profile.fields)
                  .filter(([k, v]) => v && k !== "email" && k !== "name")
                  .map(([k, v]) => (
                    <p key={k} className="text-slate-600">
                      <span className="text-slate-400">{k}: </span>
                      {v}
                    </p>
                  ))}
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">Email history</p>
              {profile.sends.length === 0 ? (
                <p className="text-sm text-slate-400">No bulk emails sent to this address yet.</p>
              ) : (
                <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {profile.sends.map((s) => (
                    <li key={s.jobId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={s.subject}>
                        {s.subject}
                      </span>
                      <span className="text-slate-400">{formatDate(s.createdAt)}</span>
                      {s.status === "sent" ? (
                        <>
                          {s.openedAt && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                              <MailOpen size={11} /> Opened{s.openCount > 1 ? ` ×${s.openCount}` : ""}
                            </span>
                          )}
                          {s.clickedAt && (
                            <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700" title={s.clickedLinks.join("\n")}>
                              <MousePointerClick size={11} /> Clicked{s.clickCount > 1 ? ` ×${s.clickCount}` : ""}
                            </span>
                          )}
                          {s.deliveryIssue && (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
                              {s.deliveryIssue === "complained" ? "Spam complaint" : s.deliveryIssue === "soft_bounced" ? "Soft bounce" : "Bounced"}
                            </span>
                          )}
                          {!s.openedAt && !s.clickedAt && !s.deliveryIssue && <span className="text-slate-400">Delivered</span>}
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-slate-500" title={s.error}>
                          {s.status === "failed" && <XCircle size={11} className="text-red-500" />}
                          {s.status === "failed" ? "Failed" : s.status === "skipped" ? "Skipped" : "Pending"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {profile.canManage && (
              <div className="flex justify-end border-t border-slate-100 pt-4">
                <button
                  onClick={toggleSuppression}
                  disabled={busy}
                  title={profile.suppression?.reason === "complained" ? "This person reported your email as spam -- only remove if they asked to be re-added." : undefined}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                    profile.suppression ? "border-slate-200 text-slate-700 hover:bg-slate-50" : "border-red-200 text-red-600 hover:bg-red-50"
                  }`}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                  {profile.suppression ? "Remove from do-not-email list" : "Add to do-not-email list"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
