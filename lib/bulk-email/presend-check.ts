// lib/bulk-email/presend-check.ts
//
// Checks run on a draft before sending (browser-side, instant). Each
// finding is an error (blocks nothing, but almost certainly a mistake),
// a warning (likely to hurt delivery or look wrong), or a tip.

export type CheckLevel = "error" | "warning" | "tip";

export interface CheckFinding {
  level: CheckLevel;
  message: string;
}

/** Gmail clips messages larger than ~102 KB, hiding the rest (including
 * the unsubscribe link) behind "View entire message". */
const GMAIL_CLIP_BYTES = 102 * 1024;

const SPAMMY_PHRASES = [
  "100% free", "act now", "buy now", "cash bonus", "click here", "congratulations", "double your",
  "earn money", "free gift", "guaranteed", "limited time", "no cost", "risk-free", "urgent", "winner", "$$$",
];

export function extractLinks(html: string): string[] {
  const links: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(["'])(.*?)\1/gi)) {
    links.push(m[2].replace(/&amp;/g, "&").trim());
  }
  return links;
}

export function runPresendChecks(input: {
  subject: string;
  preheader: string;
  bodyHtml: string;
  renderedHtml: string;
  unknownTags: string[];
  recipientCount: number;
}): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const add = (level: CheckLevel, message: string) => findings.push({ level, message });
  const subject = input.subject.trim();

  if (!subject) add("error", "The subject is empty.");
  else {
    if (subject.length > 90) add("warning", `The subject is ${subject.length} characters -- most inboxes cut it off around 60–90.`);
    const letters = subject.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= 8 && letters === letters.toUpperCase()) add("warning", "The subject is in ALL CAPS, which spam filters penalise.");
    if (/!{2,}|\?{3,}/.test(subject)) add("warning", "Repeated !!! or ??? in the subject looks spammy to filters.");
  }
  if (!input.preheader.trim()) add("tip", "No preview text -- inboxes will show the first words of the email instead.");
  if (input.recipientCount === 0) add("error", "There are no recipients.");

  if (input.unknownTags.length > 0) {
    add("warning", `${input.unknownTags.map((t) => `{{${t}}}`).join(", ")} isn't in your recipient data and will be blank.`);
  }

  const bytes = new TextEncoder().encode(input.renderedHtml).length;
  if (bytes > GMAIL_CLIP_BYTES) {
    add("warning", `The email is ${Math.round(bytes / 1024)} KB -- Gmail clips anything over 102 KB, hiding the end (including the unsubscribe link).`);
  }

  const doc = input.bodyHtml;
  const images = [...doc.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = images.filter((tag) => !/\salt\s*=\s*(["'])\s*\S/i.test(tag)).length;
  if (noAlt > 0) add("warning", `${noAlt} image${noAlt === 1 ? " has" : "s have"} no description (alt text) -- shown when images are blocked, and read by screen readers.`);
  if (images.some((tag) => /src\s*=\s*(["'])\s*data:/i.test(tag))) {
    add("warning", "An image is embedded directly in the HTML (data: URL) -- most mail clients block these. Host images online instead.");
  }

  const text = doc.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (images.length > 0 && text.length < 200) add("warning", "Mostly images and very little text -- spam filters treat image-only emails with suspicion.");

  const lower = (subject + " " + text).toLowerCase();
  const spammy = SPAMMY_PHRASES.filter((p) => lower.includes(p));
  if (spammy.length > 0) add("tip", `Phrases spam filters watch for: ${spammy.map((p) => `“${p}”`).join(", ")}.`);

  const links = extractLinks(doc);
  const placeholder = links.filter((l) => !l || l === "#" || /^https?:\/\/(www\.)?example\.(com|org)/i.test(l));
  if (placeholder.length > 0) add("error", `${placeholder.length} link${placeholder.length === 1 ? " is" : "s are"} empty, "#" or an example.com placeholder.`);
  const insecure = links.filter((l) => /^http:\/\//i.test(l));
  if (insecure.length > 0) add("tip", `${insecure.length} link${insecure.length === 1 ? " uses" : "s use"} http:// -- prefer https://.`);

  return findings;
}
