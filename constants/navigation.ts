import { Mail, ArrowLeftCircle } from "lucide-react";
import { NavigationItem } from "@/types/navigation";

export const navigation: NavigationItem[] = [
  {
    id: "email",
    title: "Email",
    icon: Mail,
    type: "collapse",
    // "Mailbox" covers webmail domains and mailboxes; "Email Marketing" is
    // the bulk email panel, one link per section (/email-marketing/<tab>).
    children: [
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
          { id: "em-overview", title: "Overview", href: "/email-marketing/overview" },
          { id: "em-compose", title: "Compose", href: "/email-marketing/compose" },
          { id: "em-history", title: "History", href: "/email-marketing/history" },
          { id: "em-lists", title: "Lists", href: "/email-marketing/lists" },
          { id: "em-forms", title: "Signup forms", href: "/email-marketing/forms" },
          { id: "em-subscribers", title: "Subscribers", href: "/email-marketing/subscribers" },
          { id: "em-templates", title: "Templates", href: "/email-marketing/templates" },
          { id: "em-unsubscribes", title: "Unsubscribes", href: "/email-marketing/unsubscribes" },
          { id: "em-settings", title: "Settings", href: "/email-marketing/settings" },
        ],
      },
    ],
  },
  {
    id: "back-to-dashboard",
    title: "Back to Dashboard",
    href: `${process.env.NEXT_PUBLIC_MAIN_APP_URL ?? ""}/dashboard`,
    icon: ArrowLeftCircle,
    type: "link",
  },
];
