"use client";

// Image library: upload images once, then pick them for any email. Opened
// from the editor's Image button and Compose's "Insert image".

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Link2, Loader2, Trash2, Upload, X } from "lucide-react";
import { apiDelete, apiGet, apiUpload, ApiError } from "@/lib/api/client";
import { inputClass } from "./ui";
import { IMAGE_SIZES, type ImageSize } from "./image-size";
import { shrinkForUpload } from "./shrink-in-browser";

export interface LibraryImage {
  id: string;
  filename: string;
  size: number;
  url: string;
  createdAt: string;
}

export default function ImageLibrary({
  onPick,
  onClose,
}: {
  onPick: (url: string, alt: string, size: ImageSize) => void;
  onClose: () => void;
}) {
  const [size, setSize] = useState<ImageSize>("medium");
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function copyUrl(img: LibraryImage) {
    navigator.clipboard.writeText(img.url).then(() => {
      setCopied(img.id);
      setTimeout(() => setCopied((c) => (c === img.id ? null : c)), 1500);
    });
  }
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await apiGet<{ images: LibraryImage[]; canManage: boolean }>("/api/email/images");
      setImages(res.images);
      setCanManage(res.canManage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your images.");
    }
  }

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      for (const original of Array.from(files)) {
        const file = await shrinkForUpload(original);
        const form = new FormData();
        form.append("file", file);
        const img = await apiUpload<LibraryImage & { shrunkFrom?: number }>("/api/email/images", form);
        setImages((list) => [img, ...(list ?? [])]);
        if (file !== original || img.shrunkFrom) {
          setNotice(`“${original.name}” was resized for email: ${(original.size / 1048576).toFixed(1)} MB → ${Math.max(1, Math.round(img.size / 1024))} KB.`);
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/api/email/images/${id}`);
      setImages((list) => (list ?? []).filter((i) => i.id !== id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the image.");
    }
  }

  const altFor = (filename: string) => filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  const local = typeof window !== "undefined" && /^(localhost|127\.)/.test(window.location.hostname);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
          <ImagePlus size={18} className="text-indigo-600" />
          <p className="text-sm font-semibold text-slate-900">Image library</p>
          {canManage && (
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload images
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <button onClick={onClose} className={`${canManage ? "" : "ml-auto"} text-slate-400 hover:text-slate-700`} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (canManage) upload(e.dataTransfer.files);
          }}
        >
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {notice && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{notice}</p>}
          {local && (
            <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              You're on localhost: image links point at this computer, so they won't show in real inboxes. Images uploaded on your live
              server work everywhere.
            </p>
          )}
          {images === null ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : images.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
              <ImagePlus size={26} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm text-slate-600">No images yet.</p>
              <p className="mt-1 text-xs text-slate-400">Upload PNG, JPG, GIF or WebP, or drop files here. Big images are resized to 1200px for email automatically.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((img) => (
                <div key={img.id} className="group overflow-hidden rounded-lg border border-slate-200">
                  <button
                    onClick={() => onPick(img.url, altFor(img.filename), size)}
                    className="flex h-32 w-full items-center justify-center bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px]"
                    title="Insert this image"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.filename} className="max-h-full max-w-full object-contain" />
                  </button>
                  <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1.5">
                    <p className="min-w-0 flex-1 truncate text-xs text-slate-600" title={img.filename}>
                      {img.filename}
                    </p>
                    <span className="shrink-0 text-[10px] text-slate-400">{Math.max(1, Math.round(img.size / 1024))} KB</span>
                    <button
                      onClick={() => copyUrl(img)}
                      className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      title="Copy the image's web address"
                      aria-label={`Copy URL of ${img.filename}`}
                    >
                      {copied === img.id ? <Check size={11} className="text-emerald-600" /> : <Link2 size={11} />}
                      {copied === img.id ? "Copied" : "Copy URL"}
                    </button>
                    {canManage &&
                      (confirmDelete === img.id ? (
                        <span className="flex items-center gap-1">
                          <button onClick={() => remove(img.id)} className="rounded bg-red-600 px-1.5 text-[10px] font-medium text-white">
                            Delete
                          </button>
                          <button onClick={() => setConfirmDelete(null)} className="text-[10px] text-slate-500">
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(img.id)}
                          className="text-slate-300 hover:text-red-600"
                          aria-label={`Delete ${img.filename}`}
                          title="Delete (emails already sent with it will show a broken image)"
                        >
                          <Trash2 size={12} />
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 pt-3 text-xs text-slate-600">
          <span className="font-medium">Insert at size:</span>
          {IMAGE_SIZES.map((s) => (
            <label key={s.key} className="flex items-center gap-1">
              <input type="radio" name="image-size" checked={size === s.key} onChange={() => setSize(s.key)} className="accent-indigo-600" />
              {s.label}
              {s.px && <span className="text-slate-400">({s.px}px)</span>}
            </label>
          ))}
          <span className="text-slate-400">· resize later by clicking the image in the editor</span>
        </div>
        <div className="flex items-center gap-2 px-5 py-3">
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="…or paste an image address (https://…)"
            className={inputClass}
          />
          <button
            onClick={() => /^https?:\/\//i.test(pasted.trim()) && onPick(pasted.trim(), "", size)}
            disabled={!/^https?:\/\//i.test(pasted.trim())}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Check size={14} /> Insert
          </button>
        </div>
      </div>
    </div>
  );
}
