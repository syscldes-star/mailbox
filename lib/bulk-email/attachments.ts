// lib/bulk-email/attachments.ts
//
// Attachment rules shared by the upload route, the send routes and the
// worker.

import { EmailAttachment } from "../models/EmailAttachment";
import type { MimeAttachment } from "./mime";

/** Total attachment size per email. OCI Email Delivery limits the whole
 * message (body + base64-encoded attachments, ~1.37x larger), so the
 * default keeps well inside its standard limit. Raise it only after
 * Oracle has raised your tenancy's message size limit. */
export const MAX_ATTACHMENTS_BYTES = Math.round((Number(process.env.BULK_EMAIL_MAX_ATTACHMENTS_MB) || 1.4) * 1024 * 1024);
export const MAX_ATTACHMENTS_PER_EMAIL = 5;

/** File types people expect to receive by email. Executables, scripts,
 * HTML and archives are refused -- they're the usual malware carriers and
 * get bulk mail blocked. */
export const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  ics: "text/calendar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function contentTypeFor(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ALLOWED_TYPES[ext] ?? null;
}

/** Validates attachment ids for a send: they must belong to the
 * workspace and fit the size limits. Returns their metadata. */
export async function resolveAttachments(workspaceId: string, ids: unknown) {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  if (list.length === 0) return { attachments: [] as { id: string; filename: string; size: number }[] };
  if (list.length > MAX_ATTACHMENTS_PER_EMAIL) return { error: `Attach at most ${MAX_ATTACHMENTS_PER_EMAIL} files.` };
  const docs = await EmailAttachment.find({ _id: { $in: list }, workspaceId }).select("filename size").lean();
  if (docs.length !== list.length) return { error: "An attachment is missing -- remove it and upload it again." };
  const total = docs.reduce((n, d) => n + d.size, 0);
  if (total > MAX_ATTACHMENTS_BYTES) {
    return { error: `Attachments total ${(total / 1048576).toFixed(1)} MB -- the limit is ${(MAX_ATTACHMENTS_BYTES / 1048576).toFixed(1)} MB per email.` };
  }
  return { attachments: docs.map((d) => ({ id: String(d._id), filename: d.filename, size: d.size })) };
}

/** Loads attachment contents for sending. */
export async function loadAttachmentData(ids: string[]): Promise<MimeAttachment[]> {
  if (ids.length === 0) return [];
  const docs = await EmailAttachment.find({ _id: { $in: ids } }).select("+data filename contentType").lean();
  if (docs.length !== ids.length) throw new Error("An attachment for this send was deleted.");
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => {
    const d = byId.get(id)!;
    // Lean queries return BSON Binary rather than a Buffer.
    const raw = d.data as unknown as Buffer | { buffer: Uint8Array };
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer);
    return { filename: d.filename, contentType: d.contentType, data };
  });
}
