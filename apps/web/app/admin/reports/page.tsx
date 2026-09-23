"use client";

import { useEffect, useState } from "react";
import { fetchReports, type ReportsData } from "../../../lib/api";
import { AdminShell, Card, ErrorNote, StatTile } from "../../../components/AdminShell";
import { BarList, ColumnChart } from "../../../components/charts";
import { ESCALATION_REASON_LABELS, MFA_LABELS, OUTCOME_LABELS, formatDuration, intentLabel, percent } from "../../../lib/format";

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
    <AdminShell title="Reports" subtitle="Call volume, containment, and verification performance.">
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Calls per day" subtitle="Last 14 days">
              <ColumnChart
                data={data.callsByDay.map((d) => ({
                  label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
                  value: d.total,
                  detail: d.total > 0 ? `${d.resolved} resolved · ${d.escalated} escalated` : undefined,
                }))}
              />
            </Card>
            <Card title="Calls by hour of day" subtitle="All time, your local time">
              <ColumnChart
                data={data.callsByHour.map((h) => ({
                  label: new Date(2000, 0, 1, h.hour).toLocaleTimeString(undefined, { hour: "numeric" }),
                  value: h.total,
                }))}
              />
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card title="Intent performance" subtitle="Resolution by the caller's detected intent">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="py-2.5 pr-4">Intent</th>
                      <th className="py-2.5 pr-4 text-right">Total calls</th>
                      <th className="py-2.5 pr-4 text-right">AI resolved</th>
                      <th className="py-2.5 pr-4 text-right">Escalated</th>
                      <th className="py-2.5 pr-4 text-right">Abandoned</th>
                      <th className="py-2.5 pr-4 text-right">Containment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.intentPerformance.map((row) => (
                      <tr key={row.intent} className="border-b border-gray-100">
                        <td className="py-2.5 pr-4 font-medium text-gray-900">{intentLabel(row.intent)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{row.total}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{row.resolved}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{row.escalated}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{row.abandoned}</td>
                        <td className="py-2.5 pr-4 text-right font-medium tabular-nums">{percent(row.resolved, row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Verification funnel" subtitle="How far callers get through identity verification">
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
              <div className="mt-5 border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">By account's verification method</p>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="py-1.5 pr-3 font-medium">Method</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Attempted</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Verified</th>
                      <th className="py-1.5 text-right font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.authMethods.map((m) => (
                      <tr key={m.configured} className="border-t border-gray-100">
                        <td className="py-1.5 pr-3 text-gray-900">{MFA_LABELS[m.configured]}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{m.attempted}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{m.verified}</td>
                        <td className="py-1.5 text-right tabular-nums">{m.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Handle time" subtitle="Average duration of calls with a recorded end">
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Overall" value={formatDuration(data.handleTime.overall.avgSeconds)} hint={`${data.handleTime.overall.calls} calls`} />
                <StatTile label={OUTCOME_LABELS.RESOLVED} value={formatDuration(aht("RESOLVED")?.avgSeconds)} hint={`${aht("RESOLVED")?.calls ?? 0} calls`} />
                <StatTile label={OUTCOME_LABELS.ESCALATED} value={formatDuration(aht("ESCALATED")?.avgSeconds)} hint={`${aht("ESCALATED")?.calls ?? 0} calls`} />
              </div>
            </Card>
            <Card title="Escalations & channels">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Escalation reasons</p>
              <div className="mt-3">
                {data.escalationReasons.length === 0 ? (
                  <p className="text-sm text-gray-500">No escalations.</p>
                ) : (
                  <BarList data={data.escalationReasons.map((r) => ({ label: ESCALATION_REASON_LABELS[r.reason] ?? r.reason, value: r.count }))} />
                )}
              </div>
              <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Channel</p>
              <div className="mt-3">
                <BarList data={data.channels.map((c) => ({ label: c.channel === "PHONE" ? "Phone (Twilio)" : "Demo (browser)", value: c.count }))} />
              </div>
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  );
}
