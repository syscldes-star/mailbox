// lib/bulk-email/template.ts
//
// Merge-tag rendering shared by the browser preview and the server-side
// sender, so what the composer previews is exactly what gets sent.
// Tags look like {{name}}, {{email}}, or {{any_csv_column}}; unknown tags
// render as empty strings rather than leaking the raw "{{...}}".

export interface TemplateVars {
  [key: string]: string | undefined;
}

const TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Values are HTML-escaped when rendering into an HTML body so a
 * recipient name like "<script>" from an uploaded CSV can't inject
 * markup into the email. */
export function renderTemplate(template: string, vars: TemplateVars, { html }: { html: boolean }): string {
  return template.replace(TAG_PATTERN, (_, key: string) => {
    const value = vars[key.toLowerCase()] ?? "";
    return html ? escapeHtml(value) : value;
  });
}

/** Tags used in a template, lowercased and de-duplicated. */
export function extractTags(template: string): string[] {
  const tags = new Set<string>();
  for (const match of template.matchAll(TAG_PATTERN)) tags.add(match[1].toLowerCase());
  return [...tags];
}

/** Plain-text alternative for the multipart message -- mail clients and
 * spam filters both treat HTML-only bulk mail with suspicion. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `${text} (${href})`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Footer appended to every bulk email: the sender's postal address
 * (required in marketing email by CAN-SPAM and similar laws) and an
 * unsubscribe link, unless the body already places {{unsubscribe_url}}
 * itself. */
export function emailFooterHtml(options: { postalAddress?: string; includeUnsubscribe: boolean }): string {
  const parts: string[] = [];
  if (options.includeUnsubscribe) {
    parts.push('Don\'t want these emails? <a href="{{unsubscribe_url}}" style="color:#94a3b8;">Unsubscribe</a>.');
  }
  const address = options.postalAddress?.trim();
  if (address) parts.push(escapeHtml(address).replace(/\r?\n/g, "<br>"));
  if (parts.length === 0) return "";
  return (
    '<p style="margin-top:32px;font-size:12px;line-height:1.5;color:#94a3b8;font-family:sans-serif;">' +
    parts.join("<br><br>") +
    "</p>"
  );
}

export function withFooter(bodyHtml: string, postalAddress?: string): string {
  const includeUnsubscribe = !/\{\{\s*unsubscribe_url\s*\}\}/i.test(bodyHtml);
  return bodyHtml + emailFooterHtml({ postalAddress, includeUnsubscribe });
}

/** Hidden inbox-preview text at the very top of the body. The trailing
 * zero-width filler stops mail clients from pulling body text into the
 * preview after it. */
export function withPreheader(bodyHtml: string, preheader?: string): string {
  const text = preheader?.trim();
  if (!text) return bodyHtml;
  const filler = "&#8199;&#65279;&#847; ".repeat(60);
  return (
    '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' +
    escapeHtml(text) +
    filler +
    "</div>" +
    bodyHtml
  );
}
