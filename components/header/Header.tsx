"use client";

import { useEffect, useRef, useState } from "react";
import { Search, UserCircle2, LogOut } from "lucide-react";
import { useSidebar } from "@/context/SidebarContext";
import { PanelLeft, Bell } from "lucide-react";
import { useAuthStore, getRoleLabel } from "@/store/useAuthStore";

export default function Header() {

  const { toggleSidebar } = useSidebar();
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : "";

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  async function handleLogout() {
    setIsMenuOpen(false);
    await logout();
    // Cross-origin, so this needs a full navigation (router.push only
    // handles routes within this app) -- sends the person back to the
    // main app's home page after logging out, rather than a /login
    // route that doesn't exist here.
    window.location.href = `${process.env.NEXT_PUBLIC_MAIN_APP_URL ?? ""}/`;
  }

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6 dark:bg-slate-900">
      {/* Left */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            type="text"
            placeholder="Search..."
            className="w-[280px] rounded-lg border bg-slate-50 py-2 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:border-indigo-500
focus:ring-2
focus:ring-indigo-500 dark:bg-slate-800"
          />
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="rounded-lg p-2 transition hover:bg-slate-100"
          >
            <PanelLeft size={20} />
          </button>

          <button className="rounded-lg p-2 transition hover:bg-slate-100">
            <Bell size={20} />
          </button>
        </div>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setIsMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <UserCircle2 size={34} />

            <div className="hidden text-left md:block">
              <p className="text-sm font-medium">
                {fullName || "..."}
              </p>

              <p className="text-xs text-slate-500">
                {getRoleLabel(role)}
              </p>
            </div>
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                <p className="truncate text-sm font-medium">{fullName || "..."}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
