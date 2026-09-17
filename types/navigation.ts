import { LucideIcon } from "lucide-react";

export interface NavigationChild {
  id: string;
  title: string;
  // A child with its own `children` is a sub-group header (e.g. "Mailbox",
  // "Email Marketing") and has no href of its own -- clicking it just
  // expands/collapses its nested items. A child with `href` and no
  // `children` is a real link, same as before.
  href?: string;
  badge?: string | null;
  children?: NavigationChild[];
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
