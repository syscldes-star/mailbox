"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";

import { NavigationItem, NavigationChild } from "@/types/navigation";
import SidebarSubMenu from "./SidebarSubMenu";
import { useSidebar } from "@/context/SidebarContext";

interface SidebarItemProps {
  item: NavigationItem;
}

// Children can now nest their own children (sub-groups like "Mailbox" /
// "Email Marketing" inside "Email"), so matching the active path or
// deciding whether to auto-open has to recurse instead of only checking
// the immediate children's href.
function childMatchesActive(child: NavigationChild, pathname: string): boolean {
  if (child.href && pathname === child.href) return true;
  return child.children?.some((c) => childMatchesActive(c, pathname)) ?? false;
}

function childMatchesStartsWith(child: NavigationChild, pathname: string): boolean {
  if (child.href && pathname.startsWith(child.href)) return true;
  return child.children?.some((c) => childMatchesStartsWith(c, pathname)) ?? false;
}

export default function SidebarItem({
  item,
}: SidebarItemProps) {
  const pathname = usePathname();

  const [open, setOpen] = useState(() => {
    if (item.id === "dashboard") return true;

    return (
      item.children?.some((child) => childMatchesStartsWith(child, pathname)) ?? false
    );
  });

  const [flyoutPosition, setFlyoutPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);

  const Icon = item.icon;

  const { collapsed } = useSidebar();

  const isActive =
    item.children?.some((child) => childMatchesActive(child, pathname)) ||
    pathname === item.href;

  function openFlyout() {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (rect) {
      setFlyoutPosition({ top: rect.top, left: rect.right + 8 });
    }
  }

  if (item.type === "link") {
    return (
      <Link
        href={item.href!}
        className={clsx(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
          isActive
            ? "bg-slate-100 font-medium text-slate-900"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        )}
      >
        <Icon size={17} />

        {!collapsed && <span>{item.title}</span>}
      </Link>
    );
  }

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={() => (collapsed ? openFlyout() : setOpen(true))}
      onMouseLeave={() =>
        collapsed ? setFlyoutPosition(null) : setOpen(false)
      }
    >
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition",
          isActive
            ? "bg-slate-100 font-medium text-slate-900"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        )}
      >
        <div className="flex items-center gap-3">
          <Icon size={17} />

          {!collapsed && <span>{item.title}</span>}
        </div>

        {!collapsed &&
          (open ? (
            <ChevronDown size={14} className="text-slate-400" />
          ) : (
            <ChevronRight size={14} className="text-slate-300" />
          ))}
      </button>

      {!collapsed && (
        <div
          className={clsx(
            "overflow-hidden transition-all duration-300",
            open ? "max-h-96" : "max-h-0"
          )}
        >
          <SidebarSubMenu items={item.children ?? []} />
        </div>
      )}

      {collapsed && flyoutPosition && (
        <div
          style={{ top: flyoutPosition.top, left: flyoutPosition.left }}
          className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <p className="px-3 py-1.5 text-xs font-semibold text-slate-400">
            {item.title}
          </p>

          <SidebarSubMenu
            items={item.children ?? []}
            variant="flyout"
          />
        </div>
      )}
    </div>
  );
}