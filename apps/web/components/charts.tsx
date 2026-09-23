"use client";

import { useState } from "react";

// Small dependency-free charts for the ops dashboard. Conventions (per the dataviz method): one
// series per chart in a single blue, thin marks (≤24px) with 4px rounded data ends grown from one
// baseline, recessive gridlines, text in ink colors (never the series color), a per-mark hover
// tooltip, and a "View as table" fallback so nothing is readable only visually.

const SERIES = "#2a78d6";

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
              {i === peak && d.value > 0 && hover === null && (
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
        <div key={d.label} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-3 text-sm" title={d.detail}>
          <span className="truncate text-gray-700">{d.label}</span>
          <div className="h-4">
            <div className="h-full rounded-r" style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100)}%`, background: SERIES }} />
          </div>
          <span className="w-16 text-right text-gray-900 tabular-nums">{valueFormat(d.value)}</span>
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
  ABANDONED: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
} as const;
