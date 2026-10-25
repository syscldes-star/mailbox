// app/api/email/files/[id]/route.ts
//
// Session-cookie protected. PUT ?n=<piece> stores one piece of a hosted
// file (raw bytes); POST {action:"complete"} checks every piece arrived
// and returns the file's public download URL.

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailFile, EmailFileChunk, FILE_CHUNK_BYTES } from "@/lib/models/EmailFile";
import { publicBaseUrl } from "@/lib/bulk-email/access";

type Params = { params: Promise<{ id: string }> };

async function ownFile(id: string, workspaceId: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return EmailFile.findOne({ _id: id, workspaceId });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const file = await ownFile((await params).id, auth.workspaceId);
  if (!file) return apiError("File not found.", 404);
  if (file.complete) return apiError("This file is already uploaded.", 409);

  const n = Number(req.nextUrl.searchParams.get("n"));
  if (!Number.isInteger(n) || n < 0 || n >= file.chunks) return apiError("Bad piece number.", 400);
  const data = Buffer.from(await req.arrayBuffer());
  const expected = n === file.chunks - 1 ? file.size - n * FILE_CHUNK_BYTES : FILE_CHUNK_BYTES;
  if (data.length !== expected) return apiError("That piece is the wrong size -- please try again.", 400);

  await EmailFileChunk.updateOne({ fileId: String(file._id), n }, { $set: { data } }, { upsert: true });
  return apiSuccess({ n });
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const file = await ownFile((await params).id, auth.workspaceId);
  if (!file) return apiError("File not found.", 404);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  if (action !== "complete") return apiError("Unknown action.", 400);

  const stored = await EmailFileChunk.countDocuments({ fileId: String(file._id) });
  if (stored !== file.chunks) return apiError(`Upload incomplete (${stored} of ${file.chunks} pieces) -- please try again.`, 409);
  file.complete = true;
  await file.save();
  const url = `${publicBaseUrl(req).replace(/\/+$/, "")}/api/files/${file._id}/${encodeURIComponent(file.filename)}`;
  return apiSuccess({ id: String(file._id), url, filename: file.filename, size: file.size });
}
