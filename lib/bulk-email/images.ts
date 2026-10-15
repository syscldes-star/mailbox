// lib/bulk-email/images.ts
//
// Public address of an image-library image.

export function imageUrl(base: string, image: { _id: unknown; ext: string }) {
  return `${base.replace(/\/+$/, "")}/api/img/${String(image._id)}.${image.ext}`;
}
