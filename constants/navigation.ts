import { Mail, ArrowLeftCircle } from "lucide-react";
import { NavigationItem } from "@/types/navigation";

export const navigation: NavigationItem[] = [
  {
    id: "email",
    title: "Email",
    icon: Mail,
    type: "collapse",
    // Mirrors main's "Email" nav structure (Mailbox + Email Marketing as
    // nested sub-groups) so the sidebar looks the same whether you're in
    // this app or in main. The "Mailbox" links are local routes (this app
    // owns that feature); "Email Marketing" links back out to main, which
    // owns campaigns/templates/statistics -- see NEXT_PUBLIC_MAIN_APP_URL.
    children: (() => {
      const MAIN_APP = process.env.NEXT_PUBLIC_MAIN_APP_URL ?? "";
      return [
        {
          id: "mailbox",
          title: "Mailbox",
          children: [
            { id: "domains", title: "Domains", href: "/domains" },
            { id: "mailboxes", title: "Mailboxes", href: "/mailboxes" },
          ],
        },
        {
          id: "email-marketing",
          title: "Email Marketing",
          children: [
            { id: "campaigns", title: "Campaigns", href: `${MAIN_APP}/emails/campaigns` },
            { id: "templates", title: "Templates", href: `${MAIN_APP}/emails/templates` },
            { id: "statistics", title: "Statistics", href: `${MAIN_APP}/emails/statistics` },
          ],
        },
      ];
    })(),
  },
  {
    id: "back-to-dashboard",
    title: "Back to Dashboard",
    href: `${process.env.NEXT_PUBLIC_MAIN_APP_URL ?? ""}/dashboard`,
    icon: ArrowLeftCircle,
    type: "link",
  },
];
