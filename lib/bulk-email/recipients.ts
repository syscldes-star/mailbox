// lib/bulk-email/recipients.ts
//
// Parses the composer's recipient input -- either a CSV (header row
// required, must include an "email" column; every other column becomes a
// merge tag) or a pasted list, one recipient per line as "email" or
// "email, Name" / "Name <email>". Used client-side for the live count and
// server-side again (never trust the browser's parse) before sending.

export const MAX_RECIPIENTS_PER_JOB = 50000;

export interface ParsedRecipient {
  email: string;
  name?: string;
  vars: Record<string, string>;
}

export interface ParseResult {
  recipients: ParsedRecipient[];
  invalid: string[];
  duplicates: number;
  columns: string[];
}

const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes (""), and
 * commas/newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function normalizeColumn(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function collect(entries: { email: string; name?: string; vars: Record<string, string>; raw: string }[], columns: string[]) {
  const seen = new Set<string>();
  const recipients: ParsedRecipient[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const entry of entries) {
    const email = entry.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      invalid.push(entry.raw);
      continue;
    }
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    const name = entry.name?.trim() || undefined;
    recipients.push({ email, name, vars: { ...entry.vars, email, name: name ?? "" } });
  }
  return { recipients, invalid, duplicates, columns };
}

/** CSV with a header row. Throws if there's no "email" column. */
export function parseRecipientsCsv(text: string): ParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { recipients: [], invalid: [], duplicates: 0, columns: [] };

  const headers = rows[0].map(normalizeColumn);
  const emailIdx = headers.findIndex((h) => h === "email" || h === "email_address" || h === "e_mail");
  if (emailIdx === -1) {
    throw new Error('CSV must have a header row with an "email" column.');
  }
  const nameIdx = headers.findIndex((h) => h === "name" || h === "full_name");
  const firstIdx = headers.indexOf("first_name");
  const lastIdx = headers.indexOf("last_name");

  const entries = rows.slice(1).map((cells) => {
    const vars: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h && i !== emailIdx) vars[h] = (cells[i] ?? "").trim();
    });
    const name =
      nameIdx !== -1
        ? cells[nameIdx]
        : [firstIdx !== -1 ? cells[firstIdx] : "", lastIdx !== -1 ? cells[lastIdx] : ""].join(" ").trim();
    return { email: cells[emailIdx] ?? "", name, vars, raw: cells.join(",") };
  });

  const columns = ["email", "name", ...headers.filter((h, i) => h && i !== emailIdx && h !== "name")];
  return collect(entries, [...new Set(columns)]);
}

/** Pasted list: "email", "email, Name", or "Name <email>" per line.
 * Lines may also be separated by commas/semicolons when there are no
 * names, e.g. a list copied from an email client's To: field. */
export function parseRecipientsList(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .flatMap((line) => {
      if (line.includes("<")) return [line];
      const parts = line.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
      return parts.length > 1 && parts.every(isValidEmail) ? parts : [line];
    })
    .map((l) => l.trim())
    .filter(Boolean);

  const entries = lines.map((line) => {
    const angle = line.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
    if (angle) return { email: angle[2], name: angle[1], vars: {}, raw: line };
    const [email, ...rest] = line.split(",");
    return { email, name: rest.join(",").trim(), vars: {}, raw: line };
  });

  return collect(entries, ["email", "name"]);
}

/** Picks CSV parsing when the first line looks like a header containing
 * an email column, otherwise treats input as a pasted list. */
export function parseRecipients(text: string): ParseResult {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const looksLikeHeader = /(^|,)\s*"?e-?mail(_address)?"?\s*(,|$)/i.test(firstLine);
  return looksLikeHeader ? parseRecipientsCsv(text) : parseRecipientsList(text);
}

/** Inverse of parseRecipientsCsv: turns stored recipients back into CSV
 * text (header row + one row each) so Compose can reuse them -- e.g.
 * "Send again" or a saved contact list. */
export function recipientsToCsv(recipients: { email: string; name?: string; vars?: Record<string, string> }[]): string {
  const extra = new Set<string>();
  for (const r of recipients) {
    for (const key of Object.keys(r.vars ?? {})) if (key !== "email" && key !== "name") extra.add(key);
  }
  const columns = ["email", "name", ...extra];
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = recipients.map((r) =>
    columns.map((c) => cell(c === "email" ? r.email : c === "name" ? r.name ?? "" : r.vars?.[c] ?? "")).join(",")
  );
  return [columns.join(","), ...rows].join("\n");
}
