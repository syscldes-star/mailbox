// lib/bulk-email/mime.ts
//
// Builds a complete RFC 5322 / MIME message, for emails with attachments
// (sent through OCI's raw submission API, which takes the finished
// message). Layout:
//   multipart/mixed
//     multipart/alternative
//       text/plain  (base64, UTF-8)
//       text/html   (base64, UTF-8)
//     attachment … (base64)

import { randomBytes, randomUUID } from "node:crypto";

export interface MimeAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MimeMessage {
  from: { email: string; name?: string };
  to: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  attachments: MimeAttachment[];
}

/** RFC 2047 encoded-word for non-ASCII header text. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function address(a: { email: string; name?: string }): string {
  if (!a.name) return a.email;
  // eslint-disable-next-line no-control-regex
  const name = /^[\x20-\x7e]*$/.test(a.name) ? `"${a.name.replace(/["\\]/g, "\\$&")}"` : encodeHeader(a.name);
  return `${name} <${a.email}>`;
}

/** Base64 wrapped at 76 characters per line, as MIME requires. */
function base64Lines(data: Buffer): string {
  return data.toString("base64").replace(/.{76}/g, "$&\r\n");
}

// eslint-disable-next-line no-control-regex
const isPlainAscii = (v: string) => /^[\x20-\x7e]*$/.test(v) && !/["\\]/.test(v);

/** Content-Disposition filename. ASCII names go as-is; anything else uses
 * RFC 2231 (filename*) alone -- adding an ASCII fallback makes some
 * clients show the mangled fallback instead of the real name. */
function filenameParams(filename: string): string {
  if (isPlainAscii(filename)) return `filename="${filename}"`;
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `filename*=UTF-8''${encoded}`;
}

/** Content-Type name parameter: plain, or an RFC 2047 encoded-word,
 * which is what older clients read. */
function nameParam(filename: string): string {
  return isPlainAscii(filename) ? `name="${filename}"` : `name="${encodeHeader(filename)}"`;
}

export function buildMimeMessage(m: MimeMessage): Buffer {
  const mixed = `mixed_${randomBytes(12).toString("hex")}`;
  const alt = `alt_${randomBytes(12).toString("hex")}`;
  const domain = m.from.email.split("@")[1] ?? "localhost";
  const crlf = "\r\n";

  const headers = [
    `From: ${address(m.from)}`,
    `To: ${address(m.to)}`,
    ...(m.replyTo ? [`Reply-To: ${m.replyTo}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];

  const parts = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(m.text, "utf8")),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(m.html, "utf8")),
    `--${alt}--`,
    "",
    ...m.attachments.flatMap((a) => [
      `--${mixed}`,
      `Content-Type: ${a.contentType}; ${nameParam(a.filename)}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; ${filenameParams(a.filename)}`,
      "",
      base64Lines(a.data),
    ]),
    `--${mixed}--`,
    "",
  ];

  return Buffer.from([...headers, "", ...parts].join(crlf), "utf8");
}
