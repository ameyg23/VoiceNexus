"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchConversations, type ConversationSummary, type EscalationReason } from "../../../lib/api";
import { AdminShell, Card, EmptyState, ErrorNote, StatTile } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";
import { ESCALATION_REASON_LABELS, formatDateTime, intentLabel } from "../../../lib/format";

// Today the only escalation path is failed caller verification (PIN lockout / OTP exhausted) — the AI
// ends with a live-agent handoff message. There's no agent routing system in this POC, so this is a
// log of handoffs for follow-up rather than a live accept-a-call queue.
export default function EscalationsPage() {
  const router = useRouter();
  const [calls, setCalls] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchConversations({ outcome: "ESCALATED" })
      .then(({ conversations }) => setCalls(conversations))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(load, [load]);

  const byReason = (reason: EscalationReason) => calls?.filter((c) => c.escalationReason === reason).length ?? 0;

  return (
    <AdminShell
      title="Escalations"
      subtitle="Calls the AI handed off to a live agent after verification failed."
      actions={
        <button onClick={load} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          ↻ Refresh
        </button>
      }
    >
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total escalated" value={calls?.length ?? "—"} />
        <StatTile label="PIN lockout" value={calls ? byReason("PIN_LOCKOUT") : "—"} />
        <StatTile label="OTP exhausted" value={calls ? byReason("OTP_FAILED") : "—"} />
        <StatTile label="Other verification failure" value={calls ? byReason("VERIFICATION_FAILED") : "—"} />
      </div>

      <Card className="mt-6" title="Handoff log">
        {!calls ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : calls.length === 0 ? (
          <EmptyState>No escalations — every caller who got as far as verification passed it.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="py-3 pr-4">Call ID</th>
                  <th className="py-3 pr-4">Time</th>
                  <th className="py-3 pr-4">Caller number</th>
                  <th className="py-3 pr-4">Account</th>
                  <th className="py-3 pr-4">Intent</th>
                  <th className="py-3 pr-4">Escalation reason</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} onClick={() => router.push(`/admin/calls/${c.id}`)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 pr-4 font-semibold text-gray-900">{c.id}</td>
                    <td className="whitespace-nowrap py-3 pr-4 text-gray-600">{formatDateTime(c.startTime)}</td>
                    <td className="py-3 pr-4 text-gray-600 tabular-nums">{c.ani}</td>
                    <td className="py-3 pr-4 text-gray-600">{c.banProvided ?? "—"}</td>
                    <td className="py-3 pr-4 text-gray-600">{intentLabel(c.detectedIntent)}</td>
                    <td className="py-3 pr-4">
                      <Badge tone="danger">{c.escalationReason ? ESCALATION_REASON_LABELS[c.escalationReason] : "—"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
