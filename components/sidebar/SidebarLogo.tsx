"use client";

import Link from "next/link";
import { useSidebar } from "@/context/SidebarContext";

export default function SidebarLogo() {

  const { collapsed } = useSidebar();

  return (
    <Link
      href="/dashboard"
      className={`flex items-center ${collapsed ? "justify-center px-0" : "gap-3 px-5"
        } py-5 border-b border-slate-800`}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
        A
      </div>

      {!collapsed && (
        <div>
          <h2 className="text-lg font-semibold"> ABC </h2>

          <p className="text-xs text-slate-400">
            All-in-One Platform
          </p>
        </div>
      )}
    </Link>
  );
}