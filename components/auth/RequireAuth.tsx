"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";

// Login/signup live in the main app -- this app only ever verifies the
// shared session cookie (same pattern as the website-builder app).
const MAIN_APP_URL = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading, checkSession } = useAuthStore();

  useEffect(() => {
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading && !user && typeof window !== "undefined") {
      const returnTo = encodeURIComponent(window.location.href);
      window.location.href = `${MAIN_APP_URL}/login?returnTo=${returnTo}`;
    }
  }, [isLoading, user]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
