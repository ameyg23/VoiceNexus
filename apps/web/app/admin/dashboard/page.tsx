"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDashboardSummary, type DashboardSummary } from "../../../lib/api";
import { AdminShell, Card, ErrorNote, StatTile } from "../../../components/AdminShell";
import { BarList, StackedBar, OUTCOME_COLORS } from "../../../components/charts";
import { CallsTable } from "../../../components/CallsTable";
import { AUTH_METHOD_LABELS, formatDuration, intentLabel, percent } from "../../../lib/format";

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const s = summary;
  const finished = s ? s.totalCalls - s.inProgress : 0;

  return (
    <AdminShell title="Dashboard overview" subtitle="Live snapshot from every call so far.">
      <ErrorNote error={error} />
      {s && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile label="Total calls" value={s.totalCalls} hint={`${s.inProgress} in progress`} />
            <StatTile label="Containment rate" value={percent(s.resolved, finished)} hint={`${s.resolved} of ${finished} resolved by AI`} />
            <StatTile label="Escalated" value={s.escalated} hint={`${percent(s.escalated, finished)} of finished calls`} />
            <StatTile label="Abandoned" value={s.abandoned} hint="Ended before verification" />
            <StatTile label="Avg handle time" value={formatDuration(s.avgHandleSeconds)} hint="Calls with a recorded end" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Call outcomes" subtitle="Every call, by how it ended">
              <StackedBar
                segments={[
                  { label: "Resolved", value: s.resolved, color: OUTCOME_COLORS.RESOLVED },
                  { label: "Escalated", value: s.escalated, color: OUTCOME_COLORS.ESCALATED },
                  { label: "Abandoned", value: s.abandoned, color: OUTCOME_COLORS.ABANDONED },
                  { label: "In progress", value: s.inProgress, color: OUTCOME_COLORS.IN_PROGRESS },
                ]}
              />
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Verified by</p>
                <div className="mt-3">
                  {s.authMethods.length === 0 ? (
                    <p className="text-sm text-gray-500">No verified calls yet.</p>
                  ) : (
                    <BarList data={s.authMethods.map((m) => ({ label: AUTH_METHOD_LABELS[m.method] ?? m.method, value: m.count }))} />
                  )}
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
