// app/api/img/[file]/route.ts
//
// Public (no session): serves image-library images at
// /api/img/<id>.<ext> so they display in recipients' inboxes. Images
// never change once uploaded, so they're cached for a long time.

import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/mongodb";
import { EmailImage } from "@/lib/models/EmailImage";

type Params = { params: Promise<{ file: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { file } = await params;
  const id = file.split(".")[0];
  if (!mongoose.isValidObjectId(id)) return new NextResponse("Not found", { status: 404 });

  await connectToDatabase();
  const image = await EmailImage.findById(id).select("data contentType").lean();
  if (!image) return new NextResponse("Not found", { status: 404 });

  const raw = image.data as unknown as Buffer | { buffer: ArrayBuffer | Buffer };
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from((raw as { buffer: Buffer }).buffer);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
