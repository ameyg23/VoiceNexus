"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDashboardSummary, fetchEscalations, type DashboardSummary, type Escalation } from "../../../lib/api";
import { AdminShell, Card, ErrorNote, StatTile } from "../../../components/AdminShell";
import { Donut, StackedBar, OUTCOME_COLORS } from "../../../components/charts";
import { Badge } from "../../../components/Badge";
import { ArrowRightIcon } from "../../../components/icons";
import { ESCALATION_REASON_LABELS, OUTCOME_LABELS, OUTCOME_TONES, formatDateTime, formatDuration, formatMoney, intentLabel } from "../../../lib/format";

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [escalations, setEscalations] = useState<Escalation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSummary = () =>
      fetchDashboardSummary()
        .then(setSummary)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    const loadEscalations = () => fetchEscalations("OPEN").then(({ escalations }) => setEscalations(escalations));

    loadSummary();
    loadEscalations();
    const poll = setInterval(() => {
      loadSummary();
      loadEscalations();
    }, 10_000); // real-time-ish: live snapshot, refreshed every 10s
    return () => clearInterval(poll);
  }, []);

  const s = summary;
  const of = (n: number) => `${n} of ${s?.finishedCalls ?? 0} calls`;
  // "Automated" = the AI handled the call end-to-end, no human involved — resolved, booked a
  // callback, or the caller left mid-call, but never escalated. "Non-automated" = handed to a
  // live agent.
  const automated = s ? s.resolved + s.callback + s.abandoned : 0;
  const automatedRate = s && s.finishedCalls > 0 ? automated / s.finishedCalls : null;

  return (
    <AdminShell title="Dashboard overview" subtitle="Live snapshot from every call so far">
      <ErrorNote error={error} />
      {s && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile label="Total Calls" value={s.totalCalls} />
            <StatTile label="Automated" value={automated} hint={automatedRate === null ? undefined : `${Math.round(automatedRate * 100)}% of finished calls`} />
            <StatTile label="Escalated to Agent" value={s.escalated} hint={s.transferRate === null ? undefined : `${Math.round(s.transferRate * 100)}% of finished calls`} />
            <StatTile label="Average Handle Time" value={formatDuration(s.avgHandleSeconds)} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Call Handling" subtitle="Automated by the AI vs. escalated to a live agent">
              <StackedBar
                segments={[
                  { label: "Automated (AI-handled)", value: automated, color: OUTCOME_COLORS.RESOLVED },
                  { label: "Escalated to agent", value: s.escalated, color: OUTCOME_COLORS.ESCALATED },
                ]}
              />
            </Card>
            <Card title="Automated Call Outcomes" subtitle="How the AI-handled calls ended">
              <StackedBar
                segments={[
                  { label: "Successful", value: s.resolved, color: OUTCOME_COLORS.RESOLVED },
                  { label: "Callback booked", value: s.callback, color: OUTCOME_COLORS.CALLBACK },
                  { label: "Abandoned", value: s.abandoned, color: OUTCOME_COLORS.ABANDONED },
                ]}
              />
            </Card>
          </div>

          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <Card title="Intents Distribution">
              <Donut data={s.intents.map((i) => ({ label: intentLabel(i.intent), value: i.count }))} centerLabel="Total Calls" />
            </Card>
            <EscalationsCard escalations={escalations} costPerCall={s.costPerCall} />
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

// Waiting/accepted escalations, at a glance — click through to the full queue for accept/resolve and
// the assistant's handoff summary. Not a separate sidebar tab anymore; this is how it's reached.
function EscalationsCard({ escalations, costPerCall }: { escalations: Escalation[] | null; costPerCall: number | null }) {
  const waiting = (escalations ?? []).filter((e) => e.status === "WAITING").length;
  const preview = (escalations ?? []).slice(0, 5);

  return (
    <Card
      title={
        <Link href="/admin/escalations" className="flex items-center justify-between gap-2 hover:text-brand-600">
          Escalations
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      }
      subtitle={waiting > 0 ? `${waiting} call${waiting === 1 ? "" : "s"} waiting for an agent` : "Nothing waiting right now"}
    >
      {!escalations ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : preview.length === 0 ? (
        <p className="text-sm text-gray-500">No open escalations. {costPerCall !== null && `Blended cost per call: ${formatMoney(costPerCall)}.`}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {preview.map((e) => (
            <li key={e.id}>
              <Link href={`/admin/calls/${e.conversationId}`} className="flex items-center justify-between gap-3 py-3 hover:bg-gray-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{e.customerName ?? "Unidentified caller"}</span>
                  <span className="block text-xs text-gray-500">{ESCALATION_REASON_LABELS[e.reason] ?? e.reason}</span>
                </span>
                <Badge tone={e.status === "WAITING" ? "warning" : "info"}>{e.status === "WAITING" ? "Waiting" : `With ${e.acceptedByName ?? "agent"}`}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/escalations" className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
        View escalation queue →
      </Link>
    </Card>
  );
}
