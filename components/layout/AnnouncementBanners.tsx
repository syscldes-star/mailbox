"use client";

import { useEffect, useState } from "react";
import { Info, TriangleAlert, X } from "lucide-react";
import clsx from "clsx";

interface Banner {
  id: string;
  title: string;
  message: string;
  tone: "info" | "warning";
}

const DISMISSED_KEY = "abc:dismissed-announcements";

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Banners from the platform admin (written in main's Admin Panel) at the
 * top of the app. Closing one hides it on this browser. */
export default function AnnouncementBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);

  useEffect(() => {
    fetch("/api/announcements", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const list: Banner[] = Array.isArray(json) ? json : (json?.data ?? []);
        const dismissed = readDismissed();
        setBanners(list.filter((a) => !dismissed.includes(a.id)));
      })
      .catch(() => undefined);
  }, []);

  function dismiss(id: string) {
    setBanners((list) => list.filter((a) => a.id !== id));
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), id].slice(-50)));
    } catch {
      // Private mode: it just comes back next time.
    }
  }

  if (banners.length === 0) return null;

  return (
    <div className="space-y-2 px-6 pt-4">
      {banners.map((a) => {
        const Icon = a.tone === "warning" ? TriangleAlert : Info;
        return (
          <div
            key={a.id}
            role="status"
            className={clsx(
              "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
              a.tone === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-indigo-200 bg-indigo-50 text-indigo-900"
            )}
          >
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.title}</p>
              <p className="mt-0.5 whitespace-pre-line opacity-90">{a.message}</p>
            </div>
            <button type="button" onClick={() => dismiss(a.id)} aria-label="Close" className="rounded p-1 opacity-70 hover:opacity-100">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
