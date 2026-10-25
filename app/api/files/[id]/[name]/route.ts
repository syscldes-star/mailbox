// app/api/files/[id]/[name]/route.ts
//
// Public (no session): downloads a file hosted from an email's Download
// button. Always served as an attachment (never rendered in the browser)
// with nosniff, so an uploaded file can't act as a web page.

import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/mongodb";
import { EmailFile, EmailFileChunk } from "@/lib/models/EmailFile";

type Params = { params: Promise<{ id: string; name: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return new NextResponse("Not found", { status: 404 });
  await connectToDatabase();
  const file = await EmailFile.findOne({ _id: id, complete: true }).lean();
  if (!file) return new NextResponse("Not found", { status: 404 });

  // Stream the pieces in order rather than loading the whole file.
  const cursor = EmailFileChunk.find({ fileId: id }).sort({ n: 1 }).lean().cursor();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await cursor.next();
      if (!chunk) {
        controller.close();
        return;
      }
      const raw = chunk.data as unknown as Buffer | { buffer: Buffer };
      controller.enqueue(new Uint8Array(Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer)));
    },
    async cancel() {
      await cursor.close();
    },
  });

  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new NextResponse(stream, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
