// Shrinks a large photo in the browser before upload, so it gets past the
// server's request-size limit (nginx) and uploads faster. The server
// shrinks again anyway; this only matters for files near or over ~1 MB.
// Images with transparency stay PNG; GIFs are left alone (could be animated).

const LIMIT = 900 * 1024;
const MAX_WIDTH = 1200;

export async function shrinkForUpload(file: File): Promise<File> {
  if (file.size <= LIMIT || !/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // Transparent pixels? Keep PNG; otherwise JPG is far smaller for photos.
    let transparent = false;
    if (file.type !== "image/jpeg") {
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < px.length; i += 4 * 16) {
        if (px[i] < 250) {
          transparent = true;
          break;
        }
      }
    }
    const type = transparent ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + (transparent ? ".png" : ".jpg");
    return new File([blob], name, { type });
  } catch {
    return file;
  }
}
