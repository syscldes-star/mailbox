// lib/bulk-email/shrink-image.ts
//
// Makes uploaded images email-friendly: scaled down to MAX_IMAGE_WIDTH,
// photos re-encoded as JPG. Images with transparency (logos) stay PNG so
// they don't get a white or black box; animated GIFs are left alone.

import sharp from "sharp";
import { MAX_IMAGE_WIDTH } from "../models/EmailImage";

export interface ShrinkResult {
  data: Buffer;
  contentType: string;
  ext: string;
  changed: boolean;
}

/** Below this size an image that's already narrow enough is kept as is. */
const SMALL_ENOUGH = 300 * 1024;

export async function shrinkImage(input: Buffer, contentType: string): Promise<ShrinkResult> {
  const unchanged = { data: input, contentType, ext: contentType.split("/")[1].replace("jpeg", "jpg"), changed: false };
  const image = sharp(input, { animated: true });
  const meta = await image.metadata();
  if ((meta.pages ?? 1) > 1) return unchanged; // animated GIF/WebP
  const tooWide = (meta.width ?? 0) > MAX_IMAGE_WIDTH;
  if (!tooWide && input.length <= SMALL_ENOUGH) return unchanged;

  const resized = sharp(input).rotate().resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true });
  const out = meta.hasAlpha
    ? { data: await resized.png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer(), contentType: "image/png", ext: "png" }
    : { data: await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), contentType: "image/jpeg", ext: "jpg" };
  // Keep the original if re-encoding didn't actually help.
  return out.data.length < input.length || tooWide ? { ...out, changed: true } : unchanged;
}
