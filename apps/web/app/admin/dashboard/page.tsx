"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDashboardSummary, type DashboardSummary } from "../../../lib/api";
import { AdminShell, Card, ErrorNote, StatTile } from "../../../components/AdminShell";
import { Donut, Gauge } from "../../../components/charts";
import { Badge } from "../../../components/Badge";
import { OUTCOME_LABELS, OUTCOME_TONES, formatDateTime, formatDuration, formatMoney, intentLabel } from "../../../lib/format";

// Status colors for the three rate gauges — good (contained), serious (sent to a human), neutral/brand.
const GAUGE = { containment: "#16a34a", escalated: "#d97706", callback: "#0d9a86" };

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const s = summary;
  const of = (n: number) => `${n} of ${s?.finishedCalls ?? 0} calls`;

  return (
    <AdminShell title="Dashboard overview" subtitle="Live snapshot from every call so far">
      <ErrorNote error={error} />
      {s && (
        <>
          {s.handoffs.waiting > 0 && (
            <Link
              href="/admin/escalations"
              className="mb-6 flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 hover:bg-amber-100"
            >
              <span>
                <strong>{s.handoffs.waiting}</strong> escalated call{s.handoffs.waiting === 1 ? " is" : "s are"} waiting for an agent.
              </span>
              <span className="font-semibold">Open queue →</span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatTile label="Total Calls" value={s.totalCalls} />
            <StatTile label="Average Handle Time" value={formatDuration(s.avgHandleSeconds)} />
            <StatTile label="Callback Backlog" value={s.callbackBacklog} />
            <StatTile label="Cost per Call" value={formatMoney(s.costPerCall)} hint="Blended, your rates" />
            <StatTile label="Care CSAT" value={s.csatAverage === null ? "—" : `${s.csatAverage}/5`} hint={`${s.csatResponses} of ${s.resolved} rated`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Containment Rate">
              <Gauge value={s.containmentRate} color={GAUGE.containment} caption={of(s.resolved)} description="Share of calls the AI resolved without escalating to a human" />
            </Card>
            <Card title="Escalated to Agent">
              <Gauge value={s.transferRate} color={GAUGE.escalated} caption={of(s.escalated)} description="Share of calls handed off to a live agent" />
            </Card>
            <Card title="Callback Rate">
              <Gauge value={s.callbackRate} color={GAUGE.callback} caption={of(s.callback)} description="Share of calls where a callback was scheduled instead" />
            </Card>
            <Card title="Intents Distribution">
              <Donut data={s.intents.map((i) => ({ label: intentLabel(i.intent), value: i.count }))} centerLabel="Total Calls" />
            </Card>
          </div>

          <Card className="mt-6" title="Recent calls">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="py-3 pr-4">Call ID</th>
                    <th className="py-3 pr-4">Intent</th>
                    <th className="py-3 pr-4">Time</th>
                    <th className="py-3 pr-4">Duration</th>
                    <th className="py-3 pr-4">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {s.recentCalls.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="whitespace-nowrap py-4 pr-4 font-semibold text-gray-900">
                        <Link href={`/admin/calls/${c.id}`} className="hover:text-brand-600">
                          {c.id}
                        </Link>
                      </td>
                      <td className="py-4 pr-4 text-gray-700">{intentLabel(c.detectedIntent)}</td>
                      <td className="whitespace-nowrap py-4 pr-4 text-gray-600">{formatDateTime(c.startTime)}</td>
                      <td className="py-4 pr-4 text-gray-600 tabular-nums">{formatDuration(c.durationSeconds)}</td>
                      <td className="py-4 pr-4">
                        <Badge tone={OUTCOME_TONES[c.outcome]}>{OUTCOME_LABELS[c.outcome]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link href="/admin/calls" className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
              View all calls →
            </Link>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
