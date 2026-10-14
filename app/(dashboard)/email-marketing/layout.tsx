import BulkEmailPanel from "@/components/bulk-email/BulkEmailPanel";

// The panel lives in the layout, not the page, so its state (an unsent
// draft, a loaded list) survives switching sections from the sidebar.
// The [tab] pages render nothing; the panel reads the tab from the URL.
export default function EmailMarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BulkEmailPanel />
      {children}
    </>
  );
}
