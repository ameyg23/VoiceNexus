"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CallActionType } from "@voice-nexus/shared";
import { fetchActions, updateActionStatus, type CallAction } from "../../../lib/api";
import { AdminShell, Card, EmptyState, ErrorNote, StatTile } from "../../../components/AdminShell";
import { Badge, type BadgeTone } from "../../../components/Badge";
import { ACTION_LABELS, formatDateOnly, formatDateTime, formatMoney } from "../../../lib/format";

const STATUS_TONE: Record<string, BadgeTone> = { SCHEDULED: "warning", COMPLETED: "success", DONE: "success", CANCELLED: "neutral" };
type Filter = "ALL" | CallActionType;

// Everything the assistant booked or completed on calls: callbacks (VN-8), technician visits
// (dispatch requests), payment promises, and the transactions it completed (payments, plan changes).
export default function FollowUpsPage() {
  const [actions, setActions] = useState<CallAction[] | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchActions()
      .then(({ actions }) => setActions(actions))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(load, [load]);

  async function mark(id: number, status: "DONE" | "CANCELLED") {
    try {
      await updateActionStatus(id, status);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const scheduled = (type: CallActionType) => actions?.filter((a) => a.type === type && a.status === "SCHEDULED").length ?? 0;
  const followUps = actions?.filter((a) => a.status === "SCHEDULED" && (filter === "ALL" || a.type === filter)) ?? [];
  const history = actions?.filter((a) => a.status !== "SCHEDULED" && (filter === "ALL" || a.type === filter)) ?? [];

  return (
    <AdminShell title="Follow-ups" subtitle="Callbacks, technician visits and payment promises the assistant booked, plus completed transactions.">
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Callbacks to make" value={scheduled("CALLBACK")} />
        <StatTile label="Technician visits" value={scheduled("TECH_VISIT")} />
        <StatTile label="Payment promises" value={scheduled("PAYMENT_PROMISE")} />
        <StatTile label="Transactions completed" value={actions?.filter((a) => a.status === "COMPLETED").length ?? 0} hint="Payments and plan changes" />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium sm:w-fit">
        {(["ALL", "CALLBACK", "TECH_VISIT", "PAYMENT_PROMISE", "PAYMENT", "PLAN_CHANGE"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 ${filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {f === "ALL" ? "All" : ACTION_LABELS[f]}
          </button>
        ))}
      </div>

      <Card className="mt-4" title="Scheduled" subtitle="Waiting on someone to act">
        {!actions ? <p className="text-sm text-gray-400">Loading…</p> : followUps.length === 0 ? <EmptyState>Nothing scheduled.</EmptyState> : <ActionTable rows={followUps} onMark={mark} />}
      </Card>
      <Card className="mt-6" title="History">
        {!actions ? <p className="text-sm text-gray-400">Loading…</p> : history.length === 0 ? <EmptyState>No history yet.</EmptyState> : <ActionTable rows={history} />}
      </Card>
    </AdminShell>
  );
}

function ActionTable({ rows, onMark }: { rows: CallAction[]; onMark?: (id: number, s: "DONE" | "CANCELLED") => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <th className="py-3 pr-4">Type</th>
            <th className="py-3 pr-4">When</th>
            <th className="py-3 pr-4">Customer</th>
            <th className="py-3 pr-4">Details</th>
            <th className="py-3 pr-4">Call</th>
            <th className="py-3 pr-4">Status</th>
            {onMark && <th className="py-3 pr-4 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-gray-100 align-top">
              <td className="py-3 pr-4 font-medium text-gray-900">{ACTION_LABELS[a.type]}</td>
              <td className="whitespace-nowrap py-3 pr-4 text-gray-600">
                {a.scheduledFor ? formatDateOnly(a.scheduledFor) : formatDateTime(a.createdAt)}
                {typeof a.details.windowLabel === "string" && <p className="text-xs text-gray-500">{a.details.windowLabel}</p>}
              </td>
              <td className="py-3 pr-4 text-gray-600">
                {a.customerId ? (
                  <Link href={`/admin/customers/${a.customerId}`} className="hover:text-brand-600">
                    {a.customerName ?? a.customerId}
                  </Link>
                ) : (
                  <span>Unverified caller</span>
                )}
                {typeof a.details.phone === "string" && <p className="text-xs text-gray-500 tabular-nums">{a.details.phone}</p>}
              </td>
              <td className="max-w-80 py-3 pr-4 text-gray-600">{detailText(a)}</td>
              <td className="py-3 pr-4">
                <Link href={`/admin/calls/${a.conversationId}`} className="text-brand-600 hover:text-brand-700">
                  {a.conversationId}
                </Link>
              </td>
              <td className="py-3 pr-4">
                <Badge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status.toLowerCase()}</Badge>
              </td>
              {onMark && (
                <td className="whitespace-nowrap py-3 pr-4 text-right">
                  <button onClick={() => onMark(a.id, "DONE")} className="rounded-md px-2 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50">
                    Mark done
                  </button>
                  <button onClick={() => onMark(a.id, "CANCELLED")} className="rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100">
                    Cancel
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function detailText(a: CallAction): string {
  const d = a.details;
  switch (a.type) {
    case "PAYMENT":
      return `Paid ${formatMoney(Number(d.amount))} (${String(d.method ?? "card on file")})`;
    case "PLAN_CHANGE":
      return `${String(d.fromPlan)} → ${String(d.toPlan)} at $${String(d.monthlyPrice)}/mo`;
    case "PAYMENT_PROMISE":
      return `Promise to pay ${formatMoney(Number(d.amount))}`;
    case "TECH_VISIT":
      return `Technician visit${d.serviceZip ? `, service ZIP ${String(d.serviceZip)}` : ""}`;
    case "CALLBACK":
      return `Call back${d.reason ? ` about ${String(d.reason).toLowerCase().replaceAll("_", " ")}` : ""}${d.verified ? " (verified caller)" : " (verify on callback)"}`;
  }
}
