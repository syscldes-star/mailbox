// Shared styling and helpers for the Bulk Email panel's tabs.

export const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500";
export const labelClass = "mb-1 block text-xs font-medium text-slate-500";
export const cardClass = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
export const primaryButton =
  "flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50";
export const secondaryButton =
  "flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

export function formatDate(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "";
}

export function downloadTextFile(filename: string, contents: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
