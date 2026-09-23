"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ConversationSummary } from "../lib/api";
import { Badge } from "./Badge";
import { OUTCOME_LABELS, OUTCOME_TONES, formatDateTime, formatDuration, intentLabel, AUTH_METHOD_LABELS } from "../lib/format";
import { EmptyState } from "./AdminShell";

// The one calls table — used by the Calls page, the dashboard's recent calls, and customer detail.
export function CallsTable({ calls, showCustomer = true, empty = "No calls yet." }: { calls: ConversationSummary[]; showCustomer?: boolean; empty?: string }) {
  const router = useRouter();
  if (calls.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="py-3 pr-4">Call ID</th>
            <th className="py-3 pr-4">Start time</th>
            <th className="py-3 pr-4">Caller number</th>
            {showCustomer && <th className="py-3 pr-4">Customer</th>}
            <th className="py-3 pr-4">Intent</th>
            <th className="py-3 pr-4">Verified by</th>
            <th className="py-3 pr-4">Status</th>
            <th className="py-3 pr-4 text-right">Duration</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr
              key={c.id}
              onClick={() => router.push(`/admin/calls/${c.id}`)}
              className="cursor-pointer border-b border-gray-100 transition hover:bg-gray-50"
            >
              <td className="whitespace-nowrap py-3 pr-4 font-semibold text-gray-900">
                <Link href={`/admin/calls/${c.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-blue-600">
                  {c.id}
                </Link>
                {c.channel === "PHONE" && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">PHONE</span>}
              </td>
              <td className="whitespace-nowrap py-3 pr-4 text-gray-600">{formatDateTime(c.startTime)}</td>
              <td className="whitespace-nowrap py-3 pr-4 text-gray-600 tabular-nums">{c.ani}</td>
              {showCustomer && <td className="py-3 pr-4 text-gray-600">{c.customerName ?? "—"}</td>}
              <td className="py-3 pr-4 text-gray-600">{intentLabel(c.detectedIntent)}</td>
              <td className="py-3 pr-4 text-gray-600">{c.authMethod ? AUTH_METHOD_LABELS[c.authMethod] : "—"}</td>
              <td className="py-3 pr-4">
                <Badge tone={OUTCOME_TONES[c.outcome]}>{OUTCOME_LABELS[c.outcome]}</Badge>
              </td>
              <td className="py-3 pr-4 text-right text-gray-600 tabular-nums">{formatDuration(c.durationSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
