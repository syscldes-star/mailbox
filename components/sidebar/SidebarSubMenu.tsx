"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { NavigationChild } from "@/types/navigation";
import clsx from "clsx";

interface SidebarSubMenuProps {
  items: NavigationChild[];
  variant?: "inline" | "flyout";
  depth?: number;
}

function hasActiveDescendant(child: NavigationChild, pathname: string): boolean {
  if (child.href && pathname === child.href) return true;
  return child.children?.some((c) => hasActiveDescendant(c, pathname)) ?? false;
}

export default function SidebarSubMenu({
  items,
  variant = "inline",
  depth = 0,
}: SidebarSubMenuProps) {
  const pathname = usePathname();

  return (
    <div
      className={clsx(
        "space-y-0.5 overflow-hidden",
        variant === "inline" ? (depth === 0 ? "mt-0.5 ml-9" : "mt-0.5 ml-4") : "mt-0"
      )}
    >
      {items.map((child) => {
        // A child with its own children is a sub-group header (e.g.
        // "Mailbox", "Email Marketing") -- render it as its own
        // expand/collapse control instead of a link.
        if (child.children && child.children.length > 0) {
          return (
            <SidebarSubMenuGroup
              key={child.id}
              item={child}
              variant={variant}
              depth={depth}
            />
          );
        }

        const isActive = pathname === child.href;

        return (
          <Link
            key={child.id}
            href={child.href!}
            className={clsx(
              "flex items-center rounded-lg px-3 py-2 text-sm transition-all duration-200",
              isActive
                ? "font-medium text-indigo-600"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            {child.title}
          </Link>
        );
      })}
    </div>
  );
}

function SidebarSubMenuGroup({
  item,
  variant,
  depth,
}: {
  item: NavigationChild;
  variant: "inline" | "flyout";
  depth: number;
}) {
  const pathname = usePathname();

  const [open, setOpen] = useState(() =>
    item.children?.some((c) => hasActiveDescendant(c, pathname)) ?? false
  );

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-all duration-200",
          "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        )}
      >
        <span>{item.title}</span>

        {open ? (
          <ChevronDown size={12} className="text-slate-400" />
        ) : (
          <ChevronRight size={12} className="text-slate-300" />
        )}
      </button>

      <div
        className={clsx(
          "overflow-hidden transition-all duration-300",
          open ? "max-h-96" : "max-h-0"
        )}
      >
        <SidebarSubMenu items={item.children ?? []} variant={variant} depth={depth + 1} />
      </div>
    </div>
  );
}
