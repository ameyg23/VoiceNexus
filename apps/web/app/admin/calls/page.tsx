"use client";

import { useEffect, useState } from "react";
import type { CallOutcome, Channel } from "@voice-nexus/shared";
import { fetchConversations, type ConversationSummary } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { CallsTable } from "../../../components/CallsTable";
import { SearchIcon } from "../../../components/icons";
import { INTENT_LABELS, OUTCOME_LABELS, AUTH_METHOD_LABELS, formatDuration, intentLabel } from "../../../lib/format";

const selectClass = "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none";

export default function CallsPage() {
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [intent, setIntent] = useState("");
  const [channel, setChannel] = useState<Channel | "">("");
  const [calls, setCalls] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deep links from other pages (e.g. Intents → /admin/calls?intent=CHECK_BALANCE). Read on mount rather
  // than via useSearchParams to avoid needing a Suspense boundary for static rendering.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("intent")) setIntent(params.get("intent")!);
    if (params.get("outcome")) setOutcome(params.get("outcome") as CallOutcome);
  }, []);

  // Debounced so typing in search doesn't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      fetchConversations({ q: q.trim(), outcome, intent, channel })
        .then(({ conversations }) => {
          setCalls(conversations);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, outcome, intent, channel]);

  function exportCsv() {
    if (!calls) return;
    const header = ["Call ID", "Start time", "End time", "Caller number", "Customer", "BAN", "Intent", "Verified by", "Status", "Duration", "Channel"];
    const rows = calls.map((c) => [
      c.id,
      c.startTime,
      c.endTime ?? "",
      c.ani,
      c.customerName ?? "",
      c.banProvided ?? "",
      intentLabel(c.detectedIntent),
      c.authMethod ? AUTH_METHOD_LABELS[c.authMethod] : "",
      OUTCOME_LABELS[c.outcome],
      formatDuration(c.durationSeconds),
      c.channel,
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-nexus-calls-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminShell
      title="Calls"
      subtitle="Search and view all calls."
      actions={
        <button onClick={exportCsv} disabled={!calls?.length} className="btn btn-secondary px-4 py-2 text-sm">
          Export CSV
        </button>
      }
    >
      <ErrorNote error={error} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-64 flex-1 sm:max-w-sm">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search call ID, caller, BAN, customer, transcript…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
            />
          </label>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome | "")} className={selectClass} aria-label="Status">
            <option value="">All statuses</option>
            {(Object.keys(OUTCOME_LABELS) as CallOutcome[]).map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
          <select value={intent} onChange={(e) => setIntent(e.target.value)} className={selectClass} aria-label="Intent">
            <option value="">All intents</option>
            {Object.entries(INTENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | "")} className={selectClass} aria-label="Channel">
            <option value="">All channels</option>
            <option value="DEMO">Demo (browser)</option>
            <option value="PHONE">Phone (Twilio)</option>
          </select>
          {calls && <span className="text-sm text-gray-500">{calls.length} calls</span>}
        </div>
        {calls ? <CallsTable calls={calls} empty="No calls match these filters." /> : <p className="text-sm text-gray-400">Loading…</p>}
      </Card>
    </AdminShell>
  );
}
