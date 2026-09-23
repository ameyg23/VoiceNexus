"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { acceptEscalation, fetchEscalations, resolveEscalation, type Escalation } from "../../../lib/api";
import { AdminShell, EmptyState, ErrorNote, StatTile } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";
import { CheckIcon } from "../../../components/icons";
import { ESCALATION_REASON_LABELS, ESCALATION_STATUS_TONES, formatDateTime, intentLabel } from "../../../lib/format";

type Tab = "OPEN" | "RESOLVED" | "ALL";

// Live-agent escalation queue (PRD VN-5). Each handoff carries the assistant's structured context —
// identity status, intent, what was already attempted — so the agent doesn't start from scratch.
export default function EscalationsPage() {
  const [tab, setTab] = useState<Tab>("OPEN");
  const [items, setItems] = useState<Escalation[] | null>(null);
  const [all, setAll] = useState<Escalation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchEscalations()
      .then(({ escalations }) => {
        setAll(escalations);
        setItems(escalations.filter((e) => (tab === "ALL" ? true : tab === "OPEN" ? e.status !== "RESOLVED" : e.status === "RESOLVED")));
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [tab]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000); // live queue
    return () => clearInterval(t);
  }, [load]);

  const count = (pred: (e: Escalation) => boolean) => all.filter(pred).length;

  return (
    <AdminShell
      title="Escalation queue"
      subtitle="Calls the assistant handed to a live agent, with the context it captured."
      actions={
        <button onClick={load} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          ↻ Refresh
        </button>
      }
    >
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Waiting" value={count((e) => e.status === "WAITING")} hint="Not yet picked up" />
        <StatTile label="In progress" value={count((e) => e.status === "ACCEPTED")} hint="Accepted by an agent" />
        <StatTile label="Resolved" value={count((e) => e.status === "RESOLVED")} />
        <StatTile label="Identity verified" value={all.length ? `${count((e) => e.verified)} of ${all.length}` : "—"} hint="Agent can skip re-verification" />
      </div>

      <div className="mt-6 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium sm:w-fit">
        {(["OPEN", "RESOLVED", "ALL"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-4 py-1.5 ${tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "OPEN" ? "Open" : t === "RESOLVED" ? "Resolved" : "All"}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {!items ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState>{tab === "OPEN" ? "No one is waiting for an agent." : "Nothing here yet."}</EmptyState>
        ) : (
          items.map((e) => <EscalationCard key={e.id} e={e} onChange={load} onError={setError} />)
        )}
      </div>
    </AdminShell>
  );
}

function EscalationCard({ e, onChange, onError }: { e: Escalation; onChange: () => void; onError: (m: string) => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onChange();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/calls/${e.conversationId}`} className="font-semibold text-gray-900 hover:text-blue-600">
              {e.conversationId}
            </Link>
            <Badge tone={ESCALATION_STATUS_TONES[e.status]}>{e.status === "ACCEPTED" ? `Accepted${e.acceptedByName ? ` by ${e.acceptedByName}` : ""}` : e.status.toLowerCase()}</Badge>
            <Badge tone={e.verified ? "success" : "warning"}>{e.verified ? "Identity verified" : "Not verified"}</Badge>
            <Badge tone="danger">{ESCALATION_REASON_LABELS[e.reason] ?? e.reason}</Badge>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {formatDateTime(e.createdAt)} · {e.customerName ?? "Unidentified caller"}
            {e.banProvided ? ` · ${e.banProvided}` : ""} · {e.ani} · wants: {intentLabel(e.intent)}
          </p>
        </div>
        {e.status === "WAITING" && (
          <button
            disabled={busy}
            onClick={() => void run(() => acceptEscalation(e.id))}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Accept
          </button>
        )}
      </div>

      <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-800">{e.summary}</p>

      {e.attempted.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Already attempted</p>
          <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
            {e.attempted.map((a) => (
              <li key={a} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.status !== "RESOLVED" ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            placeholder="Resolution notes (optional)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            disabled={busy}
            onClick={() => void run(() => resolveEscalation(e.id, notes))}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Mark resolved
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-500">
          Resolved {formatDateTime(e.resolvedAt)}
          {e.acceptedByName ? ` by ${e.acceptedByName}` : ""}
          {e.notes ? ` — “${e.notes}”` : ""}
        </p>
      )}
    </section>
  );
}
