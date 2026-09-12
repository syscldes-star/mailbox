import { LucideIcon } from "lucide-react";

export interface NavigationChild {
  id: string;
  title: string;
  href: string;
  badge?: string | null;
}

export interface NavigationItem {
  id: string;
  title: string;
  href?: string;
  icon: LucideIcon;
  type: "link" | "collapse";
  badge?: string | null;
  section?: string;
  children?: NavigationChild[];
}
