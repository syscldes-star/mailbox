// app/api/email/images/route.ts
//
// Session-cookie protected. GET lists the workspace's image library; POST
// (multipart, field "file") uploads an image. Each image gets a public
// URL so it can be used in emails.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailImage, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES } from "@/lib/models/EmailImage";
import { shrinkImage } from "@/lib/bulk-email/shrink-image";
import { MIN_SEND_ROLE, publicBaseUrl } from "@/lib/bulk-email/access";
import { imageUrl } from "@/lib/bulk-email/images";

/** File signatures, so a renamed non-image can't be served as one. */
function sniff(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  const images = await EmailImage.find({ workspaceId: auth.workspaceId }).sort({ createdAt: -1 }).limit(500).select("-data").lean();
  const base = publicBaseUrl(req);
  return apiSuccess({
    images: images.map((i) => ({ id: String(i._id), filename: i.filename, size: i.size, url: imageUrl(base, i), createdAt: i.createdAt })),
    canManage: hasMinimumRole(auth.membership.role, MIN_SEND_ROLE),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth) return apiError("Not authenticated.", 401);
  if (!hasMinimumRole(auth.membership.role, MIN_SEND_ROLE)) {
    return apiError("Only managers, admins, and owners can upload images.", 403);
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return apiError("Choose an image to upload.", 400);

  const filename = file.name.replace(/[\\/\r\n"<>]/g, "_").slice(0, 150) || "image";
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!IMAGE_TYPES[ext]) return apiError("Use a PNG, JPG, GIF or WebP image.", 400);
  if (file.size === 0) return apiError("That file is empty.", 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    return apiError(`That image is ${(file.size / 1048576).toFixed(1)} MB -- the limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`, 400);
  }
  const original = Buffer.from(await file.arrayBuffer());
  const sniffed = sniff(original);
  if (!sniffed) return apiError("That file isn't a valid PNG, JPG, GIF or WebP image.", 400);

  // Big images are scaled down and re-encoded so emails stay light.
  let shrunk;
  try {
    shrunk = await shrinkImage(original, sniffed);
  } catch {
    return apiError("That image couldn't be read -- it may be damaged. Try exporting it again.", 400);
  }
  const { data, contentType, ext: realExt } = shrunk;
  if (data.length > MAX_IMAGE_BYTES) {
    return apiError(
      `Even after shrinking, that image is ${(data.length / 1048576).toFixed(1)} MB -- the limit is 2 MB. Large GIFs can't be shrunk; try a JPG.`,
      400
    );
  }

  const image = await EmailImage.create({
    workspaceId: auth.workspaceId,
    filename,
    contentType,
    ext: realExt,
    size: data.length,
    data,
    createdBy: auth.userId,
  });
  return apiSuccess(
    {
      id: String(image._id),
      filename,
      size: data.length,
      url: imageUrl(publicBaseUrl(req), image),
      createdAt: image.createdAt,
      shrunkFrom: shrunk.changed ? original.length : undefined,
    },
    shrunk.changed ? `Image uploaded and shrunk from ${(original.length / 1048576).toFixed(1)} MB.` : "Image uploaded.",
    201
  );
}
