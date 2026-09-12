import { Mail, ArrowLeftCircle } from "lucide-react";
import { NavigationItem } from "@/types/navigation";

export const navigation: NavigationItem[] = [
  {
    id: "email",
    title: "Email",
    icon: Mail,
    type: "collapse",
    children: [
      { id: "domains", title: "Domains", href: "/email/domains" },
      { id: "mailboxes", title: "Mailboxes", href: "/email/mailboxes" },
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
