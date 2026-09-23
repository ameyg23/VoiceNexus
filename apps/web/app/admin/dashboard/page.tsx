"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDashboardSummary, type DashboardSummary } from "../../../lib/api";
import { AdminShell, Card, ErrorNote, StatTile } from "../../../components/AdminShell";
import { BarList, StackedBar, OUTCOME_COLORS } from "../../../components/charts";
import { CallsTable } from "../../../components/CallsTable";
import { ACTION_LABELS, AUTH_METHOD_LABELS, formatDuration, formatMoney, formatRate, intentLabel, percent } from "../../../lib/format";

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const s = summary;

  return (
    <AdminShell title="Dashboard overview" subtitle="Live snapshot from every call so far.">
      <ErrorNote error={error} />
      {s && (
        <>
          {s.handoffs.waiting > 0 && (
            <Link
              href="/admin/escalations"
              className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 hover:bg-amber-100"
            >
              <span>
                <strong>{s.handoffs.waiting}</strong> escalated call{s.handoffs.waiting === 1 ? " is" : "s are"} waiting for an agent.
              </span>
              <span className="font-medium">Open queue →</span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Total calls" value={s.totalCalls} hint={`${s.finishedCalls} finished · ${s.inProgress} live`} />
            <StatTile label="Containment rate" value={formatRate(s.containmentRate)} hint={`${s.resolved} resolved end-to-end by the AI`} />
            <StatTile label="Transfer rate" value={formatRate(s.transferRate)} hint={`${s.escalated} handed to a live agent`} />
            <StatTile label="Abandonment rate" value={formatRate(s.abandonmentRate)} hint={`${s.abandoned} dropped before resolution`} />
            <StatTile label="Avg handle time" value={formatDuration(s.avgHandleSeconds)} hint="Connect to close" />
            <StatTile label="Care CSAT" value={s.csatAverage === null ? "—" : `${s.csatAverage}/5`} hint={`${s.csatResponses} post-call rating${s.csatResponses === 1 ? "" : "s"}`} />
            <StatTile label="Cost per call" value={formatMoney(s.costPerCall)} hint="Blended, from your rates in Settings" />
            <StatTile
              label="Handoffs with full context"
              value={s.handoffs.total ? percent(s.handoffs.withFullContext, s.handoffs.total) : "—"}
              hint={`${s.handoffs.withFullContext} of ${s.handoffs.total} verified + intent captured`}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Call outcomes" subtitle="Every call, by how it ended">
              <StackedBar
                segments={[
                  { label: "Resolved", value: s.resolved, color: OUTCOME_COLORS.RESOLVED },
                  { label: "Escalated", value: s.escalated, color: OUTCOME_COLORS.ESCALATED },
                  { label: "Callback booked", value: s.callback, color: OUTCOME_COLORS.CALLBACK },
                  { label: "Abandoned", value: s.abandoned, color: OUTCOME_COLORS.ABANDONED },
                  { label: "In progress", value: s.inProgress, color: OUTCOME_COLORS.IN_PROGRESS },
                ]}
              />
              <div className="mt-6 grid gap-6 border-t border-gray-100 pt-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Verified by</p>
                  <div className="mt-3">
                    {s.authMethods.length === 0 ? (
                      <p className="text-sm text-gray-500">No verified calls yet.</p>
                    ) : (
                      <BarList data={s.authMethods.map((m) => ({ label: AUTH_METHOD_LABELS[m.method] ?? m.method, value: m.count }))} />
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Actions completed</p>
                  <div className="mt-3">
                    {s.actions.length === 0 ? (
                      <p className="text-sm text-gray-500">No transactions yet.</p>
                    ) : (
                      <BarList data={s.actions.map((a) => ({ label: ACTION_LABELS[a.type] ?? a.type, value: a.count }))} />
                    )}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Intents distribution" subtitle="Primary intent detected per call">
              {s.intents.length === 0 ? (
                <p className="text-sm text-gray-500">No intents detected yet.</p>
              ) : (
                <BarList
                  data={s.intents.map((i) => ({ label: intentLabel(i.intent), value: i.count }))}
                  valueFormat={(v) => `${v} · ${percent(v, s.totalCalls)}`}
                />
              )}
            </Card>
          </div>

          <Card className="mt-6" title="Recent calls">
            <CallsTable calls={s.recentCalls} />
            <Link href="/admin/calls" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
              View all calls →
            </Link>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
