// Image sizes for email bodies. Width goes both in the `width` attribute
// (Outlook ignores CSS widths) and in the style, with max-width:100% so a
// large image still shrinks on a phone.

export type ImageSize = "small" | "medium" | "large" | "full";

export const IMAGE_SIZES: { key: ImageSize; label: string; px: number | null }[] = [
  { key: "small", label: "Small", px: 200 },
  { key: "medium", label: "Medium", px: 400 },
  { key: "large", label: "Large", px: 600 },
  { key: "full", label: "Full width", px: null },
];

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function sizeStyle(size: ImageSize) {
  const px = IMAGE_SIZES.find((s) => s.key === size)?.px;
  return px ? { width: String(px), style: `width:${px}px;max-width:100%;height:auto;` } : { width: "100%", style: "width:100%;max-width:100%;height:auto;" };
}

/** `forEditor`: marks the image so finishInsertedImages() can apply the
 * size afterwards -- Chrome's insertHTML drops some of the inline style
 * (max-width, height) when pasting into the visual editor. */
export function imageHtml(url: string, alt: string, size: ImageSize, forEditor = false): string {
  const { width, style } = sizeStyle(size);
  return `<img src="${esc(url)}" alt="${esc(alt)}" width="${width}" style="${style}"${forEditor ? ` data-size="${size}"` : ""} />`;
}

/** Applies the full size style to images just inserted into the editor. */
export function finishInsertedImages(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLImageElement>("img[data-size]").forEach((img) => {
    const size = img.dataset.size as ImageSize;
    img.removeAttribute("data-size");
    applyImageSize(img, IMAGE_SIZES.some((s) => s.key === size) ? size : "medium");
  });
}

/** Resizes an image already in the editor, keeping its alignment. */
export function applyImageSize(img: HTMLImageElement, size: ImageSize) {
  const { width, style } = sizeStyle(size);
  img.setAttribute("width", width);
  img.removeAttribute("height");
  const align = img.style.marginLeft === "auto" ? (img.style.marginRight === "auto" ? "center" : "right") : img.style.display === "block" ? "left" : null;
  img.setAttribute("style", style);
  if (align) applyImageAlign(img, align);
}

export function applyImageAlign(img: HTMLImageElement, align: "left" | "center" | "right") {
  img.style.display = "block";
  img.style.marginLeft = align === "left" ? "0" : "auto";
  img.style.marginRight = align === "right" ? "0" : "auto";
}

/** Which preset an image currently matches, if any. */
export function currentImageSize(img: HTMLImageElement): ImageSize | null {
  const w = img.getAttribute("width") ?? img.style.width;
  if (w === "100%") return "full";
  const px = parseInt(w ?? "", 10);
  return IMAGE_SIZES.find((s) => s.px === px)?.key ?? null;
}
