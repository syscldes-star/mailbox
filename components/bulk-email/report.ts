// Campaign and send reports: a print-ready page (the browser's "Save as
// PDF" turns it into a PDF) and a CSV of the same numbers.

import { csvEscape, downloadTextFile } from "./ui";

export interface ReportCounts {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}

export interface ReportData {
  title: string;
  subtitle?: string;
  totals: ReportCounts;
  emails: (ReportCounts & { subject: string; date?: string; status: string })[];
  links: { label: string; url: string; clickers: number }[];
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "—");
const date = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

/** Opens a new tab right away (before any await, so popup blockers allow
 * it); fill it with writeReport once the data has loaded. */
export function openReportWindow(): Window | null {
  const w = window.open("", "_blank");
  if (w) w.document.write("<p style='font-family:sans-serif;padding:24px;color:#64748b'>Preparing report…</p>");
  return w;
}

export function writeReport(w: Window | null, r: ReportData) {
  if (!w) return;
  const t = r.totals;
  const tile = (label: string, value: string, sub = "") =>
    `<div class="tile"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`;
  const rows = r.emails
    .map(
      (e) =>
        `<tr><td>${esc(e.subject)}</td><td>${esc(date(e.date))}</td><td>${esc(e.status)}</td><td class="n">${e.sent} / ${e.total}</td>` +
        `<td class="n">${pct(e.opened, e.sent)} (${e.opened})</td><td class="n">${pct(e.clicked, e.sent)} (${e.clicked})</td>` +
        `<td class="n">${e.bounced}</td><td class="n">${e.complained}</td><td class="n">${e.failed}</td></tr>`
    )
    .join("");
  const links = r.links.length
    ? r.links
        .map(
          (l, i) =>
            `<tr><td class="n">${i + 1}</td><td>${esc(l.label)}<div class="url">${esc(l.url)}</div></td>` +
            `<td class="n">${l.clickers}</td><td class="n">${pct(l.clickers, t.sent)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No link clicks recorded.</td></tr>`;

  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)} – report</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;padding:32px;max-width:1000px}
  h1{font-size:24px;margin:0} .sub{color:#64748b;margin:4px 0 0;font-size:13px}
  h2{font-size:15px;margin:28px 0 8px}
  .tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:20px}
  .tile{border:1px solid #e2e8f0;border-radius:10px;padding:12px} .l{font-size:11px;color:#64748b}
  .v{font-size:22px;font-weight:700;margin-top:2px} .s{font-size:11px;color:#94a3b8;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:12px} th{text-align:left;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;padding:6px}
  td{border-bottom:1px solid #f1f5f9;padding:6px;vertical-align:top} .n{text-align:right;white-space:nowrap}
  .url{color:#94a3b8;font-size:11px;word-break:break-all} .muted{color:#94a3b8}
  .bar{display:flex;gap:8px;margin-bottom:20px} button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer}
  button.primary{background:#4f46e5;color:#fff;border-color:#4f46e5}
  @media print{.bar{display:none} body{padding:0}}
</style></head><body>
<div class="bar"><button class="primary" onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>
<h1>${esc(r.title)}</h1>
<p class="sub">${esc(r.subtitle ?? "")}${r.subtitle ? " · " : ""}Report generated ${esc(new Date().toLocaleString())}</p>
<div class="tiles">
  ${tile("Recipients", t.total.toLocaleString(), `${r.emails.length} email${r.emails.length === 1 ? "" : "s"}`)}
  ${tile("Delivered", t.sent.toLocaleString(), pct(t.sent, t.total) + " of recipients")}
  ${tile("Open rate", pct(t.opened, t.sent), `${t.opened.toLocaleString()} opened`)}
  ${tile("Click rate", pct(t.clicked, t.sent), `${t.clicked.toLocaleString()} clicked`)}
  ${tile("Problems", (t.failed + t.bounced + t.complained).toLocaleString(), `${t.failed} failed · ${t.bounced} bounced · ${t.complained} spam`)}
</div>
<h2>Emails</h2>
<table><thead><tr><th>Subject</th><th>Date</th><th>Status</th><th class="n">Delivered</th><th class="n">Opened</th><th class="n">Clicked</th><th class="n">Bounced</th><th class="n">Spam</th><th class="n">Failed</th></tr></thead>
<tbody>${rows || `<tr><td colspan="9" class="muted">Nothing sent yet.</td></tr>`}</tbody></table>
<h2>Top links</h2>
<table><thead><tr><th class="n">#</th><th>Link</th><th class="n">People</th><th class="n">Of delivered</th></tr></thead><tbody>${links}</tbody></table>
<p class="sub" style="margin-top:24px">Opens are counted when the email's images load, so some mail apps under-report them; clicks are exact.</p>
</body></html>`);
  w.document.close();
}

export function downloadReportCsv(filename: string, r: ReportData) {
  const row = (cells: unknown[]) => cells.map((c) => csvEscape(String(c ?? ""))).join(",");
  const t = r.totals;
  const lines = [
    row(["Report", r.title]),
    row(["Generated", new Date().toISOString()]),
    "",
    row(["Recipients", "Delivered", "Opened", "Open rate", "Clicked", "Click rate", "Bounced", "Spam complaints", "Failed", "Skipped"]),
    row([t.total, t.sent, t.opened, pct(t.opened, t.sent), t.clicked, pct(t.clicked, t.sent), t.bounced, t.complained, t.failed, t.skipped]),
    "",
    row(["Subject", "Date", "Status", "Recipients", "Delivered", "Opened", "Open rate", "Clicked", "Click rate", "Bounced", "Spam", "Failed", "Skipped"]),
    ...r.emails.map((e) =>
      row([e.subject, e.date ?? "", e.status, e.total, e.sent, e.opened, pct(e.opened, e.sent), e.clicked, pct(e.clicked, e.sent), e.bounced, e.complained, e.failed, e.skipped])
    ),
    "",
    row(["Link", "URL", "People clicked", "Of delivered"]),
    ...r.links.map((l) => row([l.label, l.url, l.clickers, pct(l.clickers, t.sent)])),
  ];
  downloadTextFile(filename, lines.join("\n"));
}
