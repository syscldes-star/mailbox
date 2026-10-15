// lib/bulk-email/link-stats.ts
//
// Per-link click counts for the click map and reports. Click tracking
// records the exact URL each person opened -- after merge tags were
// filled in and campaign (UTM) tags added -- so to line clicks up with
// the links in the email, both sides are reduced to the same key: the
// address without utm_* tags or personalised query values.

import mongoose from "mongoose";
import { BulkRecipient } from "../models/BulkRecipient";
import { escapeHtml } from "./template";

/** Query parameters that differ per reader or are added at send time. */
const VOLATILE_PARAMS = /^(utm_[a-z]+|k|email)$/i;

export interface TemplateLink {
  /** Position of the link in the email, from 0. */
  index: number;
  href: string;
  /** Visible text of the link (or "image" for an image link). */
  label: string;
}

export interface LinkStat extends TemplateLink {
  clickers: number;
}

/** Unique people who clicked each recorded URL, across one or more sends. */
export async function clicksByUrl(jobIds: string[]): Promise<Map<string, number>> {
  const ids = jobIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return new Map();
  const rows = await BulkRecipient.aggregate<{ _id: string; n: number }>([
    { $match: { jobId: { $in: ids }, "clickedLinks.0": { $exists: true } } },
    { $unwind: "$clickedLinks" },
    { $group: { _id: "$clickedLinks", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

function decodeAttr(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Links the click map counts: http(s), or a merge tag that fills in a
 * link -- but not the unsubscribe link, which is never click-tracked. */
function isTrackable(href: string) {
  if (/^\{\{\s*unsubscribe_url\s*\}\}$/i.test(href)) return false;
  return /^https?:\/\//i.test(href) || /^\{\{/.test(href);
}

const ANCHOR = /<a\b([^>]*?)\shref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;

/** The http(s) links in an email body, in order. */
export function templateLinks(bodyHtml: string): TemplateLink[] {
  const links: TemplateLink[] = [];
  for (const m of bodyHtml.matchAll(ANCHOR)) {
    const href = decodeAttr(m[3].trim());
    if (!isTrackable(href)) continue;
    const text = m[5].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    links.push({ index: links.length, href, label: text || (/<img\b/i.test(m[5]) ? "image" : href) });
  }
  return links;
}

/** Comparable key for a link: host + path + its fixed query values. */
export function linkKey(url: string): string {
  try {
    const u = new URL(url.replace(/\{\{[^}]*\}\}/g, "__tag__"));
    const params = [...u.searchParams.entries()]
      .filter(([k, v]) => !VOLATILE_PARAMS.test(k) && !v.includes("__tag__"))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}${query}`;
  } catch {
    return url;
  }
}

/**
 * Matches clicks to the email's links. Several links with the same
 * address (e.g. a logo and a button) share its clicks, so each is shown
 * with the address's total. Clicks on addresses not in the email (a
 * changed template, an unsubscribe-page link) are returned as `other`.
 */
export function matchClicks(links: TemplateLink[], clicks: Map<string, number>) {
  const byKey = new Map<string, number>();
  for (const [url, n] of clicks) byKey.set(linkKey(url), (byKey.get(linkKey(url)) ?? 0) + n);
  const used = new Set<string>();
  const stats: LinkStat[] = links.map((l) => {
    const key = linkKey(l.href);
    used.add(key);
    return { ...l, clickers: byKey.get(key) ?? 0 };
  });
  const other = [...byKey.entries()]
    .filter(([key]) => !used.has(key))
    .map(([url, clickers]) => ({ url, clickers }))
    .sort((a, b) => b.clickers - a.clickers);
  return { stats, other };
}

/**
 * The email with a badge after every link showing how many people
 * clicked it -- the darker the badge, the more clicks. Scripts never run
 * in it (it's shown in a sandboxed frame).
 */
export function clickMapHtml(bodyHtml: string, stats: LinkStat[], sent: number): string {
  const max = Math.max(1, ...stats.map((s) => s.clickers));
  let i = 0;
  const marked = bodyHtml.replace(ANCHOR, (whole, _a, _q, raw: string) => {
    const href = decodeAttr(raw.trim());
    if (!isTrackable(href)) return whole;
    const s = stats[i++];
    if (!s) return whole;
    const strength = s.clickers / max;
    const bg = s.clickers === 0 ? "#e2e8f0" : strength > 0.66 ? "#dc2626" : strength > 0.33 ? "#f97316" : "#facc15";
    const fg = s.clickers === 0 ? "#475569" : strength > 0.33 ? "#ffffff" : "#422006";
    const rate = sent ? ` · ${Math.round((s.clickers / sent) * 100)}%` : "";
    const badge =
      `<span style="display:inline-block;margin:2px 4px;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};` +
      `font:600 12px/1.6 sans-serif;vertical-align:middle;white-space:nowrap" title="${escapeHtml(href)}">` +
      `${s.clickers} click${s.clickers === 1 ? "" : "s"}${rate}</span>`;
    return `<span style="outline:2px dashed ${bg};outline-offset:2px;border-radius:4px">${whole}</span>${badge}`;
  });
  return (
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    '<style>body{margin:0;padding:24px;font-family:sans-serif;background:#fff}img{max-width:100%;height:auto}</style>' +
    `</head><body>${marked}</body></html>`
  );
}
