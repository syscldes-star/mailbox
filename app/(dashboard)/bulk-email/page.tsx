import { redirect } from "next/navigation";

// Old address of the panel -- keeps existing bookmarks working.
export default function BulkEmailRedirect() {
  redirect("/email-marketing/compose");
}
