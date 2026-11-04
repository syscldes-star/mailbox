"use client";

// Lightweight rich-text editor for email bodies, built on contentEditable
// so it needs no extra dependency. Produces plain, inline-styled HTML
// that mail clients render reliably.
//
// Safety: the editor renders HTML inside the dashboard itself (unlike the
// sandboxed preview iframe), so it only ever shows HTML that passes
// isVisualSafe(), and every paste is sanitised. Anything more complex
// (style blocks, scripts, forms, event handlers) stays in HTML mode.

import { useEffect, useRef, useState } from "react";
import ImageLibrary from "./ImageLibrary";
import { applyImageAlign, applyImageSize, currentImageSize, finishInsertedImages, IMAGE_SIZES, imageHtml, type ImageSize } from "./image-size";
import {
  Bold,
  Italic,
  Underline,
  Heading2,
  Pilcrow,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  Minus,
  MousePointer2,
  Undo2,
  Redo2,
  RemoveFormatting,
} from "lucide-react";

const UNSAFE_TAGS = /<\s*(script|style|iframe|object|embed|form|input|button|link|meta|base|svg|math)\b/i;
const EVENT_ATTR = /\son[a-z]+\s*=/i;
const JS_URL = /(href|src)\s*=\s*["']?\s*(javascript|data|vbscript):/i;

/** True when the HTML is simple enough to show in the visual editor. */
export function isVisualSafe(html: string): boolean {
  return !UNSAFE_TAGS.test(html) && !EVENT_ATTR.test(html) && !JS_URL.test(html);
}

const ALLOWED_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "p", "br", "div", "span", "h1", "h2", "h3", "h4",
  "ul", "ol", "li", "img", "hr", "blockquote", "table", "thead", "tbody", "tr", "td", "th", "font", "center",
]);
const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "style", "width", "height", "align", "target", "colspan", "rowspan", "color"]);

/** Keeps only known-safe tags and attributes; used on paste. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap unknown containers but drop dangerous ones entirely.
        if (/^(script|style|iframe|object|embed|form|input|button|link|meta|base|svg|math|template|noscript)$/.test(tag)) {
          child.remove();
        } else {
          walk(child);
          child.replaceWith(...Array.from(child.childNodes));
        }
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (!ALLOWED_ATTRS.has(name) || ((name === "href" || name === "src") && /^(javascript|data|vbscript):/.test(value))) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export default function VisualEditor({
  value,
  onChange,
  editorRef,
}: {
  value: string;
  onChange: (html: string) => void;
  /** Exposes the editable element so the parent can insert merge tags at the caret. */
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastEmitted = useRef<string>("");
  const [showLibrary, setShowLibrary] = useState(false);
  // Image the user clicked in the editor, with its position for the
  // highlight box (drawn as an overlay so nothing is added to the HTML).
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  function measure(img: HTMLImageElement | null) {
    if (!img || !wrapRef.current || !ref.current?.contains(img)) {
      setImgBox(null);
      return;
    }
    const a = img.getBoundingClientRect();
    const b = wrapRef.current.getBoundingClientRect();
    setImgBox({ top: a.top - b.top, left: a.left - b.left, width: a.width, height: a.height });
  }

  function selectImage(img: HTMLImageElement | null) {
    setSelectedImg(img);
    measure(img);
  }

  // Re-measure once the image toolbar has rendered (it moves the editor down).
  useEffect(() => {
    measure(selectedImg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImg]);

  /** Change the selected image, then save the HTML. */
  function editImage(change: (img: HTMLImageElement) => void) {
    if (!selectedImg) return;
    change(selectedImg);
    emit();
    requestAnimationFrame(() => measure(selectedImg));
  }

  // Only overwrite the DOM when the value changed from outside (template
  // loaded, HTML mode edit) -- never on our own input, or the caret jumps.
  useEffect(() => {
    if (ref.current && value !== lastEmitted.current) {
      ref.current.innerHTML = value;
      lastEmitted.current = value;
    }
  }, [value]);

  function emit() {
    if (!ref.current) return;
    lastEmitted.current = ref.current.innerHTML;
    onChange(ref.current.innerHTML);
  }

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }

  function insertHtml(html: string) {
    exec("insertHTML", html);
  }

  function addLink() {
    const url = window.prompt("Link address (https://…)");
    if (!url) return;
    if (!/^(https?:|mailto:|tel:|\{\{)/i.test(url.trim())) {
      window.alert("Links must start with https://, http://, mailto: or tel:");
      return;
    }
    const selection = window.getSelection()?.toString();
    if (selection) exec("createLink", url.trim());
    else insertHtml(`<a href="${escapeAttr(url.trim())}">${escapeAttr(url.trim())}</a>`);
  }

  // The library opens in a dialog, which takes focus from the editor, so
  // the caret position is remembered and restored before inserting.
  const savedRange = useRef<Range | null>(null);
  function addImage() {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setShowLibrary(true);
  }

  function insertImage(url: string, alt: string, size: ImageSize = "medium") {
    setShowLibrary(false);
    ref.current?.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    insertHtml(imageHtml(url, alt, size, true));
    finishInsertedImages(ref.current);
    emit();
  }

  function addButton() {
    const url = window.prompt("Button link (https://…)");
    if (!url) return;
    if (!/^(https?:|\{\{)/i.test(url.trim())) {
      window.alert("Button links must start with https:// or http://");
      return;
    }
    const label = window.prompt("Button text", "Learn more") || "Learn more";
    insertHtml(
      `<p><a href="${escapeAttr(url.trim())}" style="display:inline-block;background:#4f46e5;color:#ffffff;` +
        `padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-family:sans-serif;">` +
        `${escapeAttr(label)}</a></p>`
    );
  }

  const tools: { icon: React.ElementType; label: string; run: () => void }[] = [
    { icon: Bold, label: "Bold", run: () => exec("bold") },
    { icon: Italic, label: "Italic", run: () => exec("italic") },
    { icon: Underline, label: "Underline", run: () => exec("underline") },
    { icon: Heading2, label: "Heading", run: () => exec("formatBlock", "<h2>") },
    { icon: Pilcrow, label: "Paragraph", run: () => exec("formatBlock", "<p>") },
    { icon: List, label: "Bulleted list", run: () => exec("insertUnorderedList") },
    { icon: ListOrdered, label: "Numbered list", run: () => exec("insertOrderedList") },
    { icon: AlignLeft, label: "Align left", run: () => exec("justifyLeft") },
    { icon: AlignCenter, label: "Center", run: () => exec("justifyCenter") },
    { icon: Link2, label: "Link", run: addLink },
    { icon: MousePointer2, label: "Button", run: addButton },
    { icon: ImageIcon, label: "Image", run: addImage },
    { icon: Minus, label: "Divider", run: () => insertHtml('<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />') },
    { icon: RemoveFormatting, label: "Clear formatting", run: () => exec("removeFormat") },
    { icon: Undo2, label: "Undo", run: () => exec("undo") },
    { icon: Redo2, label: "Redo", run: () => exec("redo") },
  ];

  const imgSize = selectedImg ? currentImageSize(selectedImg) : null;

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-lg border border-slate-200 focus-within:ring-2 focus-within:ring-indigo-500">
      <div className="flex flex-wrap gap-0.5 border-b border-slate-200 bg-slate-50 p-1">
        {tools.map(({ icon: Icon, label, run }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            // Keep the selection in the editor when clicking a tool.
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
            className="rounded p-1.5 text-slate-600 hover:bg-white hover:text-slate-900"
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
      {selectedImg && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-indigo-100 bg-indigo-50 px-2 py-1.5 text-xs text-slate-700" onMouseDown={(e) => e.preventDefault()}>
          <span className="font-medium text-indigo-900">Image:</span>
          {IMAGE_SIZES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => editImage((img) => applyImageSize(img, s.key))}
              className={`rounded px-2 py-0.5 ${imgSize === s.key ? "bg-indigo-600 text-white" : "bg-white hover:bg-indigo-100"}`}
            >
              {s.label}
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} type="button" onClick={() => editImage((img) => applyImageAlign(img, a))} className="rounded bg-white px-2 py-0.5 capitalize hover:bg-indigo-100">
              {a}
            </button>
          ))}
          <span className="mx-1 text-slate-300">|</span>
          <button
            type="button"
            onClick={() => {
              const alt = window.prompt("Alt text (shown if the image doesn't load; read aloud by screen readers)", selectedImg.alt);
              if (alt !== null) editImage((img) => img.setAttribute("alt", alt));
            }}
            className="rounded bg-white px-2 py-0.5 hover:bg-indigo-100"
          >
            Alt text
          </button>
          <button
            type="button"
            onClick={() => {
              selectedImg.remove();
              emit();
              selectImage(null);
            }}
            className="rounded bg-white px-2 py-0.5 text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
          <button type="button" onClick={() => selectImage(null)} className="ml-auto text-slate-500 hover:text-slate-800">
            Done
          </button>
        </div>
      )}
      {imgBox && (
        <div
          className="pointer-events-none absolute z-10 rounded-sm outline outline-2 outline-offset-2 outline-indigo-500"
          style={{ top: imgBox.top, left: imgBox.left, width: imgBox.width, height: imgBox.height }}
        />
      )}
      <div
        onClick={(e) => selectImage(e.target instanceof HTMLImageElement ? e.target : null)}
        onKeyDown={(e) => e.key === "Escape" && selectImage(null)}
        onScroll={() => measure(selectedImg)}
        ref={(el) => {
          ref.current = el;
          if (editorRef) editorRef.current = el;
        }}
        contentEditable
        suppressContentEditableWarning
        onInput={() => {
          emit();
          if (selectedImg && !ref.current?.contains(selectedImg)) selectImage(null);
          else measure(selectedImg);
        }}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          if (html) {
            insertHtml(sanitizeHtml(html));
          } else {
            exec("insertText", e.clipboardData.getData("text/plain"));
          }
        }}
        className="prose-email min-h-[260px] max-w-none bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 outline-none [&_a]:text-indigo-600 [&_a]:underline [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-semibold [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
      />
      {showLibrary && <ImageLibrary onPick={insertImage} onClose={() => setShowLibrary(false)} />}
    </div>
  );
}

/** Inserts text at the caret inside the given editable element (used for merge tags). */
export function insertTextAtCaret(el: HTMLElement | null, text: string) {
  return insertAtCaret(el, "insertText", text);
}

/** Inserts an HTML snippet at the caret (used for signup-form buttons). */
export function insertHtmlAtCaret(el: HTMLElement | null, html: string) {
  return insertAtCaret(el, "insertHTML", html);
}

function insertAtCaret(el: HTMLElement | null, command: "insertText" | "insertHTML", value: string) {
  if (!el) return false;
  // Checked before focus(), which would otherwise put the caret at the
  // very start when the editor hasn't been clicked into yet.
  const selection = window.getSelection();
  const hadCaret = !!selection && selection.rangeCount > 0 && el.contains(selection.anchorNode);
  el.focus();
  if (!hadCaret && command === "insertHTML") {
    // A block (e.g. a button paragraph) goes on its own line at the end
    // rather than being merged into the last paragraph.
    el.insertAdjacentHTML("beforeend", value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (!hadCaret) {
    // No caret inside the editor -- put it at the end.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  // Start a new line first so an inserted block isn't merged into the
  // paragraph the caret is in.
  if (command === "insertHTML") document.execCommand("insertParagraph");
  document.execCommand(command, false, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
