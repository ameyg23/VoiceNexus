"use client";

import { useEffect, useState } from "react";
import { fetchReports, type ReportsData } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { BarList, ColumnChart, Donut, LineChart } from "../../../components/charts";
import { ACTION_LABELS, ESCALATION_REASON_LABELS, MFA_LABELS, formatDuration, formatMoney, formatRate, intentLabel, percent } from "../../../lib/format";

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReports()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const aht = (outcome: "RESOLVED" | "ESCALATED") => data?.handleTime.byOutcome.find((h) => h.outcome === outcome);

  return (
    <AdminShell title="Reports" subtitle="Call volume, containment and service quality">
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Call Volume" subtitle="Calls per day, last 14 days">
              <LineChart
                data={data.callsByDay.map((d) => ({
                  label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
                  value: d.total,
                  detail: d.total > 0 ? `${d.resolved} resolved · ${d.escalated} escalated` : undefined,
                }))}
              />
            </Card>
            <Card title="Peak Hours" subtitle="Calls by hour of day, your local time">
              <ColumnChart
                data={data.callsByHour.map((h) => ({
                  // Compact axis labels ("12a", "3p") so every tick fits.
                  label: `${h.hour % 12 === 0 ? 12 : h.hour % 12}${h.hour < 12 ? "a" : "p"}`,
                  value: h.total,
                }))}
              />
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card title="Intent Performance" subtitle="Resolution performance by customer intent">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th className="py-3 pr-4">Intent</th>
                      <th className="py-3 pr-4 text-right">Total calls</th>
                      <th className="py-3 pr-4 text-right">AI resolved</th>
                      <th className="py-3 pr-4 text-right">Escalated</th>
                      <th className="py-3 pr-4 text-right">Callback</th>
                      <th className="py-3 pr-4 text-right">Containment rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.intentPerformance.map((row) => (
                      <tr key={row.intent} className="border-b border-gray-100 last:border-0">
                        <td className="py-4 pr-4 font-semibold text-gray-900">{intentLabel(row.intent)}</td>
                        <td className="py-4 pr-4 text-right text-gray-700 tabular-nums">{row.total}</td>
                        <td className="py-4 pr-4 text-right font-medium text-green-600 tabular-nums">{row.resolved}</td>
                        <td className="py-4 pr-4 text-right font-medium text-amber-600 tabular-nums">{row.escalated}</td>
                        <td className="py-4 pr-4 text-right text-gray-700 tabular-nums">{row.callback}</td>
                        <td className="py-4 pr-4 text-right font-semibold text-gray-900 tabular-nums">{percent(row.resolved, row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Escalation Analysis" subtitle="Why calls went to a live agent">
              <Donut data={data.escalationReasons.map((r) => ({ label: ESCALATION_REASON_LABELS[r.reason] ?? r.reason, value: r.count }))} centerLabel="Escalated" />
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Handle Time Analysis" subtitle="Average time from connect to close">
              <Columns
                items={[
                  { label: "Overall AHT", value: formatDuration(data.handleTime.overall.avgSeconds), hint: `${data.handleTime.overall.calls} calls` },
                  { label: "AI-resolved AHT", value: formatDuration(aht("RESOLVED")?.avgSeconds), hint: `${aht("RESOLVED")?.calls ?? 0} calls` },
                  { label: "Escalated AHT", value: formatDuration(aht("ESCALATED")?.avgSeconds), hint: `${aht("ESCALATED")?.calls ?? 0} calls` },
                ]}
              />
            </Card>
            <Card title="Business Impact" subtitle="Key operational and experience metrics">
              <Columns
                items={[
                  { label: "Escalation volume", value: String(data.kpis.escalated), hint: `${formatRate(data.kpis.transferRate)} of calls` },
                  {
                    label: "AI context handoff",
                    value: data.kpis.handoffs.total ? percent(data.kpis.handoffs.withFullContext, data.kpis.handoffs.total) : "—",
                    hint: "Verified + intent captured",
                  },
                  { label: "Cost per call", value: formatMoney(data.kpis.costPerCall), hint: "Blended, your rates" },
                  { label: "Care CSAT", value: data.kpis.csatAverage === null ? "—" : `${data.kpis.csatAverage}/5`, hint: `${data.kpis.csatResponses} ratings` },
                ]}
              />
            </Card>
          </div>

          <Card className="mt-6" title="Containment & Quality" subtitle="Over finished calls — calibrate targets against your own pre-VoiceNexus baseline">
            <Columns
              items={[
                { label: "IVR containment", value: formatRate(data.kpis.containmentRate), hint: `${data.kpis.resolved} of ${data.kpis.finishedCalls} resolved end-to-end` },
                { label: "Transfer rate", value: formatRate(data.kpis.transferRate), hint: `${data.kpis.escalated} to a live agent` },
                { label: "Callback rate", value: formatRate(data.kpis.callbackRate), hint: `${data.kpis.callback} callbacks booked` },
                { label: "Abandonment rate", value: formatRate(data.kpis.abandonmentRate), hint: `${data.kpis.abandoned} dropped` },
                {
                  label: "Reply latency",
                  value: data.kpis.latency.medianMs === null ? "—" : `${(data.kpis.latency.medianMs / 1000).toFixed(2)}s`,
                  hint: data.kpis.latency.p90Ms === null ? "Median · target ≤ 1.0s" : `Median · p90 ${(data.kpis.latency.p90Ms / 1000).toFixed(2)}s`,
                },
              ]}
            />
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Verification Funnel" subtitle="How far callers get through identity verification">
              <BarList
                max={data.funnel.calls}
                valueFormat={(v) => `${v} · ${percent(v, data.funnel.calls)}`}
                data={[
                  { label: "Calls", value: data.funnel.calls },
                  { label: "Gave a BAN", value: data.funnel.banProvided },
                  { label: "Account found", value: data.funnel.accountFound },
                  { label: "Verified", value: data.funnel.verified },
                ]}
              />
              <table className="mt-6 w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="py-2 pr-3">Method</th>
                    <th className="py-2 pr-3 text-right">Attempted</th>
                    <th className="py-2 pr-3 text-right">Verified</th>
                    <th className="py-2 text-right">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.authMethods.map((m) => (
                    <tr key={m.configured} className="border-b border-gray-100 last:border-0">
                      <td className="py-2.5 pr-3 text-gray-900">{MFA_LABELS[m.configured]}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{m.attempted}</td>
                      <td className="py-2.5 pr-3 text-right text-green-600 tabular-nums">{m.verified}</td>
                      <td className="py-2.5 text-right text-amber-600 tabular-nums">{m.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="grid gap-6">
              <Card title="Post-call CSAT" subtitle="1 = very dissatisfied, 5 = very satisfied">
                {data.kpis.csatResponses === 0 ? (
                  <p className="text-sm text-gray-500">No ratings yet.</p>
                ) : (
                  <BarList data={[...data.csatDistribution].reverse().map((c) => ({ label: `${c.score} star${c.score === 1 ? "" : "s"}`, value: c.count }))} />
                )}
              </Card>
              <Card title="Transactions & Bookings" subtitle="What the assistant completed or scheduled">
                {data.actionsByType.length === 0 ? (
                  <p className="text-sm text-gray-500">None yet.</p>
                ) : (
                  <BarList
                    data={Object.values(
                      data.actionsByType.reduce<Record<string, { label: string; value: number }>>((acc, a) => {
                        if (a.status === "CANCELLED") return acc;
                        acc[a.type] ??= { label: ACTION_LABELS[a.type] ?? a.type, value: 0 };
                        acc[a.type].value += a.count;
                        return acc;
                      }, {})
                    )}
                  />
                )}
                <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-gray-500">Channel</p>
                <div className="mt-3">
                  <BarList data={data.channels.map((c) => ({ label: c.channel === "PHONE" ? "Phone (Twilio)" : "Demo (browser)", value: c.count }))} />
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}

// The reference's "label over big number" columns, separated by a rule.
function Columns({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-gray-100 pt-5 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {items.map((i) => (
        <div key={i.label}>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{i.label}</p>
          <p className="mt-3 text-[28px] font-bold leading-none text-gray-900 tabular-nums">{i.value}</p>
          {i.hint && <p className="mt-2 text-xs text-gray-500">{i.hint}</p>}
        </div>
      ))}
    </div>
  );
}
