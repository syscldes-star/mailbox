import { notFound, redirect } from "next/navigation";
import { MOVED_TABS, TABS, type Tab } from "@/components/bulk-email/tabs";

export default async function EmailMarketingTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (MOVED_TABS[tab]) redirect(MOVED_TABS[tab]);
  if (!TABS.includes(tab as Tab)) notFound();
  return null;
}
