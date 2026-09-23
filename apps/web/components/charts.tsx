"use client";

import { useState } from "react";

// Small dependency-free charts for the ops dashboard. Conventions (per the dataviz method): one
// series per chart in the brand teal, thin marks (≤24px) with 4px rounded data ends grown from one
// baseline, recessive gridlines, text in ink colors (never the series color), a per-mark hover
// tooltip, and a "View as table" fallback so nothing is readable only visually.

// Chart teal: a brighter step of the brand color (the deep brand teal reads gray at chart sizes).
// CATEGORICAL was run through the dataviz validator (light mode): all checks pass; yellow/pink sit
// under 3:1 vs the surface, so categorical charts always carry direct labels + a table view.
export const SERIES = "#0d9a86";
export const CATEGORICAL = ["#0d9a86", "#eb6834", "#4a3aa7", "#eda100", "#2a78d6", "#e87ba4"];

export interface Datum {
  label: string;
  value: number;
  detail?: string; // extra tooltip line
}

export function ColumnChart({ data, height = 180, valueLabel = "calls" }: { data: Datum[]; height?: number; valueLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  // Label every Nth tick so the axis never collides.
  const tickEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div>
      <div className="relative" style={{ height }}>
        {[0, 0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-gray-100" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -top-2 left-0 -translate-x-full pr-1 text-[10px] text-gray-400 tabular-nums">{Math.round(max * f)}</span>
          </div>
        ))}
        <div className="absolute inset-0 ml-1 flex items-end">
          {data.map((d, i) => (
            <div
              key={d.label}
              className="relative flex h-full flex-1 cursor-default items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {d.value > 0 && (
                <div
                  className="w-full max-w-6 rounded-t transition-opacity"
                  style={{ height: `${(d.value / max) * 100}%`, background: SERIES, opacity: hover === null || hover === i ? 1 : 0.45, margin: "0 1px" }}
                />
              )}
              {d.value > 0 && hover === null && (i === peak || data.filter((x) => x.value > 0).length <= 12) && (
                <span className="absolute text-[10px] font-medium text-gray-700 tabular-nums" style={{ bottom: `calc(${(d.value / max) * 100}% + 2px)` }}>
                  {d.value}
                </span>
              )}
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md">
                  <p className="font-medium text-gray-900">{d.label}</p>
                  <p className="text-gray-600 tabular-nums">
                    {d.value} {valueLabel}
                  </p>
                  {d.detail && <p className="text-gray-500">{d.detail}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-1 mt-1 flex border-t border-gray-300">
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 truncate pt-1 text-center text-[10px] text-gray-500">
            {i % tickEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
      <TableView rows={data.map((d) => [d.label, String(d.value), d.detail ?? ""])} headers={["", valueLabel, ""]} />
    </div>
  );
}

// Horizontal bars — for ranked categories (intents) and ordered stages (verification funnel).
export function BarList({ data, valueFormat = (v: number) => String(v), max: maxOverride }: { data: Datum[]; valueFormat?: (v: number) => string; max?: number }) {
  const max = maxOverride ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm" title={d.detail}>
          <span className="leading-tight text-gray-700">{d.label}</span>
          <div className="h-4">
            <div className="h-full rounded-r" style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100)}%`, background: SERIES }} />
          </div>
          <span className="min-w-10 whitespace-nowrap text-right text-gray-900 tabular-nums">{valueFormat(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  color: string;
}

// One stacked bar of mutually exclusive states (call outcomes). Legend always present, with counts,
// so state is never color-alone.
export function StackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div>
      <div className="flex h-4 gap-0.5 overflow-hidden rounded bg-gray-100">
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div key={s.label} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
            ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
            <span className="font-medium text-gray-900 tabular-nums">{s.value}</span>
            <span className="text-gray-400 tabular-nums">({total > 0 ? Math.round((s.value / total) * 100) : 0}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableView({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <details className="mt-3 text-xs text-gray-500">
      <summary className="cursor-pointer select-none hover:text-gray-700">View as table</summary>
      <table className="mt-2 w-full max-w-sm">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="py-1 pr-3 text-left font-medium text-gray-600">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100">
              {r.map((c, j) => (
                <td key={j} className="py-1 pr-3 text-gray-700 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// Outcome state colors — reserved for status, always paired with a text label.
export const OUTCOME_COLORS = {
  RESOLVED: "#16a34a",
  ESCALATED: "#dc2626",
  CALLBACK: "#8b5cf6",
  ABANDONED: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
} as const;

// Semicircle gauge for a single rate (containment, transfer, callback). A hero number with a context
// line — one value, so no legend.
export function Gauge({ value, color, caption, description }: { value: number | null; color: string; caption: string; description: string }) {
  const r = 70;
  const circumference = Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value));
  const label = value === null ? "—" : `${(pct * 100).toFixed(1)}%`;
  return (
    <div className="flex flex-col items-center text-center">
      <svg viewBox="0 0 180 100" className="w-48" role="img" aria-label={`${label} — ${caption}`}>
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="#e5e7eb" strokeWidth="14" strokeLinecap="round" />
        {pct > 0 && (
          <path
            d="M20 90 A70 70 0 0 1 160 90"
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${pct * circumference} ${circumference}`}
          />
        )}
        <text x="90" y="82" textAnchor="middle" className="fill-gray-900 text-[26px] font-bold">
          {label}
        </text>
      </svg>
      <p className="mt-2 text-sm font-semibold text-gray-900">{caption}</p>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}

// Donut for a share-of-whole split (intents, escalation reasons). Slices beyond the palette fold into
// "Other"; the legend always shows label + percentage, so identity never rests on color alone.
export function Donut({ data, centerLabel }: { data: Datum[]; centerLabel: string }) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, CATEGORICAL.length - 1);
  const rest = sorted.slice(CATEGORICAL.length - 1).reduce((s, d) => s + d.value, 0);
  const slices = rest > 0 ? [...top, { label: "Other", value: rest }] : sorted.slice(0, CATEGORICAL.length);
  const total = slices.reduce((s, d) => s + d.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0; // 2px surface gap between segments
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 140 140" className="h-40 w-40 -rotate-90" role="img" aria-label={`${total} ${centerLabel}`}>
          <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f5f9" strokeWidth="18" />
          {total > 0 &&
            slices.map((s, i) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.label}
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={CATEGORICAL[i]}
                  strokeWidth="18"
                  strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${s.label}: ${s.value}`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-gray-900 tabular-nums">{total}</span>
          <span className="text-xs text-gray-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORICAL[i] }} />
            <span className="min-w-0 flex-1 leading-snug text-gray-700">
              {s.label}
            </span>
            <span className="text-gray-900 tabular-nums">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
        {slices.length === 0 && <li className="text-gray-500">No data yet.</li>}
      </ul>
    </div>
  );
}

// Line chart for change over time (calls per day): 2px line, 8px markers, crosshair + tooltip on hover.
export function LineChart({ data, height = 200, valueLabel = "calls" }: { data: Datum[]; height?: number; valueLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 600;
  const pad = { l: 28, r: 12, t: 16, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const tickEvery = Math.max(1, Math.ceil(data.length / 7));
  const band = w / Math.max(1, data.length);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`${valueLabel} over time`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#f1f5f9" />
            <text x={pad.l - 6} y={y(max * f) + 3} textAnchor="end" className="fill-gray-400 text-[10px]">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="#cbd5e1" strokeDasharray="3 3" />}
        <polyline points={points} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 4} fill={SERIES} stroke="white" strokeWidth="2" />
            {i % tickEvery === 0 && (
              <text x={x(i)} y={height - 8} textAnchor="middle" className="fill-gray-500 text-[10px]">
                {d.label}
              </text>
            )}
            <rect x={x(i) - band / 2} y={0} width={band} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(x(hover) / w) * 100}%` }}
        >
          <p className="font-medium text-gray-900">{data[hover].label}</p>
          <p className="text-gray-600 tabular-nums">
            {data[hover].value} {valueLabel}
          </p>
          {data[hover].detail && <p className="text-gray-500">{data[hover].detail}</p>}
        </div>
      )}
      <TableView rows={data.map((d) => [d.label, String(d.value), d.detail ?? ""])} headers={["", valueLabel, ""]} />
    </div>
  );
}
