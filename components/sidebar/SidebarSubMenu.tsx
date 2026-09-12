"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationChild } from "@/types/navigation";
import clsx from "clsx";

interface SidebarSubMenuProps {
  items: NavigationChild[];
  variant?: "inline" | "flyout";
}

export default function SidebarSubMenu({
  items,
  variant = "inline",
}: SidebarSubMenuProps) {
  const pathname = usePathname();

  return (
    <div
      className={clsx(
        "space-y-0.5 overflow-hidden",
        variant === "inline" ? "mt-0.5 ml-9" : "mt-0"
      )}
    >
      {items.map((child) => {
        const isActive = pathname === child.href;

        return (
          <Link
            key={child.id}
            href={child.href}
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