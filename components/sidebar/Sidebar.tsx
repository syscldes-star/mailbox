"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import clsx from "clsx";

import { navigation } from "@/constants/navigation";
import { useSidebar } from "@/context/SidebarContext";

import SidebarItem from "./SidebarItem";
import SidebarLogo from "./SidebarLogo";

export default function Sidebar() {
  const { collapsed } = useSidebar();
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();

  const filteredNavigation = normalizedQuery
    ? navigation.filter((item) => {
      const titleMatches = item.title
        .toLowerCase()
        .includes(normalizedQuery);

      const childMatches = item.children?.some((child) =>
        child.title.toLowerCase().includes(normalizedQuery)
      );

      return titleMatches || childMatches;
    })
    : navigation;

  return (
    <aside
      className={clsx(
        "flex h-screen flex-col border-r border-slate-200 bg-white text-slate-700 shadow-sm transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <SidebarLogo />

      {!collapsed && (
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Search size={15} className="shrink-0 text-slate-400" />

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu..."
              className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex-1 space-y-0.5 overflow-y-auto border-t border-slate-100 px-3 py-3">
        {filteredNavigation.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-slate-400">
            No results
          </p>
        ) : (
          filteredNavigation.map((item) => (
            <SidebarItem key={item.id} item={item} />
          ))
        )}
      </div>
    </aside>
  );
}
