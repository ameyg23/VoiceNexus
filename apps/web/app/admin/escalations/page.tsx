"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { acceptEscalation, fetchEscalations, resolveEscalation, type Escalation } from "../../../lib/api";
import { AdminShell, Card, EmptyState, ErrorNote } from "../../../components/AdminShell";
import { Badge } from "../../../components/Badge";
import { CheckIcon } from "../../../components/icons";
import { ESCALATION_REASON_LABELS, ESCALATION_STATUS_TONES, formatDateTime, intentLabel } from "../../../lib/format";

type Tab = "OPEN" | "RESOLVED" | "ALL";

// Live-agent escalation queue (PRD VN-5). Each handoff carries the assistant's structured context —
// identity status, intent, what was already attempted — so the agent doesn't start from scratch.
export default function EscalationsPage() {
  const [tab, setTab] = useState<Tab>("OPEN");
  const [all, setAll] = useState<Escalation[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetchEscalations()
      .then(({ escalations }) => {
        setAll(escalations);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000); // live queue
    const tick = setInterval(() => setNow(Date.now()), 1000); // wait-time clocks
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const items = (all ?? []).filter((e) => (tab === "ALL" ? true : tab === "OPEN" ? e.status !== "RESOLVED" : e.status === "RESOLVED"));
  const waiting = (all ?? []).filter((e) => e.status === "WAITING").length;

  return (
    <AdminShell title="Escalation Queue" subtitle="Live escalated calls waiting for agents">
      <ErrorNote error={error} />
      <Card>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <p className="text-[15px] text-gray-700">
              <span className="font-semibold text-gray-900">{waiting}</span> waiting
            </p>
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm font-medium">
              {(["OPEN", "RESOLVED", "ALL"] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1 ${tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                  {t === "OPEN" ? "Open" : t === "RESOLVED" ? "Resolved" : "All"}
                </button>
              ))}
            </div>
          </div>
          <button onClick={load} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
            ↻ Refresh
          </button>
        </div>

        {!all ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState>{tab === "OPEN" ? "No one is waiting for an agent." : "Nothing here yet."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="py-3 pr-4">Call ID</th>
                  <th className="py-3 pr-4">Caller number</th>
                  <th className="py-3 pr-4">Intent</th>
                  <th className="py-3 pr-4">Wait time</th>
                  <th className="py-3 pr-4">Escalation reason</th>
                  <th className="py-3 pr-4">Identity</th>
                  <th className="py-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <Fragment key={e.id}>
                    <tr onClick={() => setOpen(open === e.id ? null : e.id)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
                      <td className="whitespace-nowrap py-4 pr-4 font-semibold text-gray-900">{e.conversationId}</td>
                      <td className="whitespace-nowrap py-4 pr-4 text-gray-700 tabular-nums">{e.ani}</td>
                      <td className="py-4 pr-4 text-gray-700">{intentLabel(e.intent)}</td>
                      <td className="py-4 pr-4">
                        <WaitPill e={e} now={now} />
                      </td>
                      <td className="py-4 pr-4 text-gray-700">{ESCALATION_REASON_LABELS[e.reason] ?? e.reason}</td>
                      <td className="py-4 pr-4">
                        <Badge tone={e.verified ? "success" : "warning"}>{e.verified ? "Verified" : "Not verified"}</Badge>
                      </td>
                      <td className="whitespace-nowrap py-4 pr-4 text-right">
                        {e.status === "WAITING" ? (
                          <AcceptButton id={e.id} onDone={load} onError={setError} />
                        ) : (
                          <Badge tone={ESCALATION_STATUS_TONES[e.status]}>{e.status === "ACCEPTED" ? `With ${e.acceptedByName ?? "agent"}` : "Resolved"}</Badge>
                        )}
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <td colSpan={7} className="px-4 py-5">
                          <Handoff e={e} onChange={load} onError={setError} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500">Click a row to see the assistant&apos;s handoff summary.</p>
          </div>
        )}
      </Card>
    </AdminShell>
  );
}

// Wait time since the handoff; green under 1 minute, amber under 3, red beyond — with the time as text.
function WaitPill({ e, now }: { e: Escalation; now: number }) {
  if (e.status !== "WAITING") return <span className="text-gray-400">—</span>;
  const secs = Math.max(0, Math.round((now - new Date(e.createdAt).getTime()) / 1000));
  const tone = secs < 60 ? "bg-green-50 text-green-700" : secs < 180 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  const text = secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` : `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${tone}`}>{text}</span>;
}

function AcceptButton({ id, onDone, onError }: { id: number; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={(ev) => {
        ev.stopPropagation();
        setBusy(true);
        acceptEscalation(id)
          .then(onDone)
          .catch((err) => onError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      }}
      className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
    >
      Accept
    </button>
  );
}

function Handoff({ e, onChange, onError }: { e: Escalation; onChange: () => void; onError: (m: string) => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Handoff summary</p>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-800">{e.summary}</p>
        {e.attempted.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500">Already attempted</p>
            <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
              {e.attempted.map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  {a}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-xs text-gray-500">
          {formatDateTime(e.createdAt)} · {e.customerName ?? "Unidentified caller"}
          {e.banProvided ? ` · ${e.banProvided}` : ""} ·{" "}
          <Link href={`/admin/calls/${e.conversationId}`} className="font-medium text-brand-600 hover:text-brand-700">
            Open call →
          </Link>
        </p>
      </div>
      <div>
        {e.status !== "RESOLVED" ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Close out</p>
            <textarea
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              rows={3}
              placeholder="Resolution notes (optional)"
              className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                resolveEscalation(e.id, notes)
                  .then(onChange)
                  .catch((err) => onError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false));
              }}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100 disabled:opacity-50"
            >
              Mark resolved
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Resolved {formatDateTime(e.resolvedAt)}
            {e.acceptedByName ? ` by ${e.acceptedByName}` : ""}
            {e.notes ? ` — “${e.notes}”` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
