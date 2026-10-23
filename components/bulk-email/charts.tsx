"use client";

// Small SVG charts for the Overview page: a line chart (with crosshair),
// a bar chart, and a diverging bar chart (above/below a zero line).
// Thin marks, hairline grid, hover + keyboard (← →) tooltips; every chart
// on the page also has a table view, so tooltips never gate a value.

import { useEffect, useRef, useState, type ReactNode } from "react";

export const SERIES = { blue: "#2a78d6", orange: "#eb6834", red: "#e34948" };
const GRID = "#e8e7e4";
const INK_MUTED = "#8a8985";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** "Nice" upper bound and ticks for a 0-based axis. Counts (`whole`)
 * step in whole numbers -- there's no such thing as 2.5 people. */
function niceScale(max: number, ticks = 4, whole = false) {
  if (max <= 0) return whole ? { top: ticks, step: 1 } : { top: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  // 2.5 isn't a whole-number step; use 2 (or 1 below that) instead.
  if (whole) step = Math.max(1, Math.round(step === 2.5 * mag ? 2 * mag : step));
  return { top: step * Math.ceil(max / step), step };
}

/** A bar with a 4px rounded data end and a square base. */
function barPath(x: number, y0: number, w: number, h: number, up: boolean) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  if (up) {
    const top = y0 - h;
    return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`;
  }
  const bottom = y0 + h;
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${y0}Z`;
}

export interface TooltipRow {
  color?: string;
  value: string;
  label: string;
}

function Tooltip({ x, width, title, rows, extra }: { x: number; width: number; title: string; rows: TooltipRow[]; extra?: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(0, width - 230));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 w-[220px] rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-lg"
      style={{ left: x + 12 + 230 > width ? Math.max(0, x - 232) : left }}
    >
      <p className="mb-1 font-medium text-slate-500">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2">
          {r.color && <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />}
          <span className="font-semibold text-slate-900">{r.value}</span>
          <span className="text-slate-500">{r.label}</span>
        </p>
      ))}
      {extra}
    </div>
  );
}

const PAD = { top: 12, right: 64, bottom: 24, left: 44 };

function XTicks({ labels, x, height }: { labels: string[]; x: (i: number) => number; height: number }) {
  const every = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <>
      {labels.map((l, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
            {i === labels.length - 1 || i % every === 0 ? l : ""}
          </text>
        ) : null
      )}
    </>
  );
}

/** Index under the pointer / keyboard; shared by all three charts. */
function useHover(count: number) {
  const [hover, setHover] = useState<number | null>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(count - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? count) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };
  return { hover, setHover, onKey };
}

export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];
}

export function LineChart({
  labels,
  tooltipTitles,
  series,
  format,
  height = 220,
  extra,
  ariaLabel,
  connectGaps = false,
}: {
  labels: string[];
  tooltipTitles: string[];
  series: LineSeries[];
  /** Draw through periods with no value (they mean "no data", not zero). */
  connectGaps?: boolean;
  format: (v: number) => string;
  height?: number;
  extra?: (i: number) => ReactNode;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const { hover, setHover, onKey } = useHover(n);
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const { top, step } = niceScale(max);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        if (!connectGaps) pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i)},${y(v)}`;
      pen = true;
    });
    return d;
  };
  const lastIndex = (values: (number | null)[]) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
    return -1;
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left - PAD.left;
            setHover(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (px / plotW) * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(t)}
              </text>
            </g>
          ))}
          <XTicks labels={labels} x={x} height={height} />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="#b9b8b3" strokeWidth={1} />}
          {series.map((s) => {
            const li = lastIndex(s.values);
            return (
              <g key={s.label}>
                <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* With gaps bridged, mark where real data points are. */}
                {connectGaps &&
                  s.values.map((v, i) => (v !== null ? <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} /> : null))}
                {/* Isolated points (no neighbour to draw a line to) still show. */}
                {!connectGaps && s.values.map((v, i) =>
                  v !== null && (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null ? (
                    <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color} />
                  ) : null
                )}
                {li >= 0 && (
                  <>
                    <circle cx={x(li)} cy={y(s.values[li]!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                    <text x={x(li) + 8} y={y(s.values[li]!) + 4} fontSize={11} fill="#52514e" fontWeight={600}>
                      {format(s.values[li]!)}
                    </text>
                  </>
                )}
                {hover !== null && s.values[hover] !== null && (
                  <circle cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip
          x={x(hover)}
          width={width}
          title={tooltipTitles[hover]}
          rows={series
            .filter((s) => s.values[hover] !== null)
            .map((s) => ({ color: s.color, label: s.label, value: format(s.values[hover]!) }))}
          extra={extra?.(hover)}
        />
      )}
    </div>
  );
}

export function BarChart({
  labels,
  tooltipTitles,
  values,
  color,
  label,
  height = 110,
  ariaLabel,
}: {
  labels: string[];
  tooltipTitles: string[];
  values: number[];
  color: string;
  label: string;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = values.length;
  const { hover, setHover, onKey } = useHover(n);
  const { top, step } = niceScale(Math.max(0, ...values), 2, true);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  // Bars are centred on the same x positions as the line chart above.
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const band = n <= 1 ? plotW : plotW / (n - 1);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y0 = PAD.top + plotH;

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} className="outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onPointerLeave={() => setHover(null)}>
          {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y0 - (t / top) * plotH} y2={y0 - (t / top) * plotH} stroke={GRID} />
              <text x={PAD.left - 8} y={y0 - (t / top) * plotH + 4} textAnchor="end" fontSize={11} fill={INK_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {t.toLocaleString()}
              </text>
            </g>
          ))}
          <XTicks labels={labels} x={x} height={height} />
          {values.map((v, i) => (
            <g key={i} onPointerEnter={() => setHover(i)}>
              {/* Hit area: the whole column, not just the painted bar. */}
              <rect x={x(i) - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" />
              <path d={barPath(x(i) - barW / 2, y0, barW, (v / top) * plotH, true)} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
            </g>
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip x={x(hover)} width={width} title={tooltipTitles[hover]} rows={[{ color, label, value: values[hover].toLocaleString() }]} />
      )}
    </div>
  );
}

export function DivergingBarChart({
  labels,
  tooltipTitles,
  up,
  down,
  upLabel,
  downLabel,
  height = 220,
  extra,
  ariaLabel,
}: {
  labels: string[];
  tooltipTitles: string[];
  up: number[];
  down: number[];
  upLabel: string;
  downLabel: string;
  height?: number;
  extra?: (i: number) => ReactNode;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = up.length;
  const { hover, setHover, onKey } = useHover(n);
  const { top, step } = niceScale(Math.max(1, ...up, ...down), 2, true);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const half = plotH / 2;
  const zero = PAD.top + half;
  const band = n ? plotW / n : plotW;
  const x = (i: number) => PAD.left + band * i + band / 2;
  const barW = Math.max(2, Math.min(24, band - 2));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step);

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} className="outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onPointerLeave={() => setHover(null)}>
          {ticks.flatMap((t) => (t === 0 ? [0] : [t, -t])).map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={zero - (t / top) * half} y2={zero - (t / top) * half} stroke={t === 0 ? "#b9b8b3" : GRID} />
              <text x={PAD.left - 8} y={zero - (t / top) * half + 4} textAnchor="end" fontSize={11} fill={INK_MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
                {t > 0 ? `+${t}` : t === 0 ? "0" : `−${-t}`}
              </text>
            </g>
          ))}
          <XTicks labels={labels} x={x} height={height} />
          {up.map((v, i) => (
            <g key={i} onPointerEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.55}>
              <rect x={x(i) - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" />
              {/* 1px gap either side of the zero line keeps the two bars apart. */}
              <path d={barPath(x(i) - barW / 2, zero - 1, barW, (v / top) * half, true)} fill={SERIES.blue} />
              <path d={barPath(x(i) - barW / 2, zero + 1, barW, (down[i] / top) * half, false)} fill={SERIES.red} />
            </g>
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip
          x={x(hover)}
          width={width}
          title={tooltipTitles[hover]}
          rows={[
            { color: SERIES.blue, label: upLabel, value: `+${up[hover]}` },
            { color: SERIES.red, label: downLabel, value: `−${down[hover]}` },
            { label: "net", value: `${up[hover] - down[hover] > 0 ? "+" : up[hover] - down[hover] < 0 ? "−" : ""}${Math.abs(up[hover] - down[hover])}` },
          ]}
          extra={extra?.(hover)}
        />
      )}
    </div>
  );
}

/** Legend: a short line (for lines) or square (for bars) in the series colour. */
export function Legend({ items }: { items: { label: string; color: string; kind: "line" | "bar" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.kind === "line" ? (
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: it.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
