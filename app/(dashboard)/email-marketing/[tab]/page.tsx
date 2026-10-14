import { notFound } from "next/navigation";
import { TABS, type Tab } from "@/components/bulk-email/tabs";

export default async function EmailMarketingTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!TABS.includes(tab as Tab)) notFound();
  return null;
}
