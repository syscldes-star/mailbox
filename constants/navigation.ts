import { Mail, ArrowLeftCircle, LifeBuoy } from "lucide-react";
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
          { id: "em-campaigns", title: "Campaigns", href: "/email-marketing/campaigns" },
          { id: "em-compose", title: "Compose", href: "/email-marketing/compose" },
          { id: "em-history", title: "History", href: "/email-marketing/history" },
          { id: "em-lists", title: "Lists", href: "/email-marketing/lists" },
          { id: "em-forms", title: "Signup forms", href: "/email-marketing/forms" },
          { id: "em-subscribers", title: "Subscribers", href: "/email-marketing/subscribers" },
          { id: "em-engagement", title: "Engagement", href: "/email-marketing/engagement" },
          { id: "em-templates", title: "Templates", href: "/email-marketing/templates" },
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
  {
    // Support tickets live in main.
    id: "get-help",
    title: "Get help",
    href: `${process.env.NEXT_PUBLIC_MAIN_APP_URL ?? ""}/support`,
    icon: LifeBuoy,
    type: "link",
  },
];
