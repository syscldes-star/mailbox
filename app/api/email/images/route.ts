// app/api/email/images/route.ts
//
// Session-cookie protected. GET lists the workspace's image library; POST
// (multipart, field "file") uploads an image. Each image gets a public
// URL so it can be used in emails.

import { NextRequest } from "next/server";
import { requireAuth, hasMinimumRole } from "@/lib/api/requireAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { EmailImage, IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/models/EmailImage";
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
  if (file.size > MAX_IMAGE_BYTES) {
    return apiError(`That image is ${(file.size / 1048576).toFixed(1)} MB -- the limit is 2 MB. Large images also load slowly in email.`, 400);
  }
  const data = Buffer.from(await file.arrayBuffer());
  const contentType = sniff(data);
  if (!contentType) return apiError("That file isn't a valid PNG, JPG, GIF or WebP image.", 400);
  const realExt = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[contentType]!;

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
    { id: String(image._id), filename, size: data.length, url: imageUrl(publicBaseUrl(req), image), createdAt: image.createdAt },
    "Image uploaded.",
    201
  );
}
