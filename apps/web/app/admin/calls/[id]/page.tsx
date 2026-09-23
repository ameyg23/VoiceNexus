"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { conversationAudioUrl, fetchConversation, type ConversationDetail } from "../../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../../components/AdminShell";
import { Badge } from "../../../../components/Badge";
import { CheckIcon, PersonIcon, WaveformIcon } from "../../../../components/icons";
import {
  ACTION_LABELS,
  AUTH_METHOD_LABELS,
  ESCALATION_REASON_LABELS,
  ESCALATION_STATUS_TONES,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  formatDateTime,
  formatDuration,
  formatTime,
  intentLabel,
} from "../../../../lib/format";

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const load = () =>
      fetchConversation(id)
        .then((d) => {
          if (cancelled) return;
          setDetail(d);
          // Live view (PRD VN-10 agent-assist): while the call is in progress, keep the transcript current.
          if (d.conversation.outcome === "IN_PROGRESS") timer = setTimeout(load, 3000);
        })
        .catch((err) => setError(err instanceof Error && err.message.startsWith("404") ? `No call with ID ${id}.` : String(err)));
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const c = detail?.conversation;
  const live = c?.outcome === "IN_PROGRESS";

  return (
    <AdminShell
      title={`Call Details — ${id}`}
      subtitle={
        <Link href="/admin/calls" className="text-blue-600 hover:text-blue-700">
          ← All calls
        </Link>
      }
    >
      <ErrorNote error={error} />
      {detail && c && (
        <>
          <div className="flex flex-wrap gap-3">
            <Tile label="Status">
              <Badge tone={OUTCOME_TONES[c.outcome]}>{OUTCOME_LABELS[c.outcome]}</Badge>
            </Tile>
            <Tile label="Duration">{formatDuration(c.durationSeconds)}</Tile>
            <Tile label="Intent">{intentLabel(c.detectedIntent)}</Tile>
            <Tile label="Verified by">{c.authMethod ? AUTH_METHOD_LABELS[c.authMethod] : "Not verified"}</Tile>
            <Tile label="Resolved by">{c.outcome === "ESCALATED" ? "Agent (escalated)" : c.outcome === "CALLBACK" ? "Callback" : "VoiceNexus"}</Tile>
            <Tile label="CSAT">{c.csatScore ? `${c.csatScore}/5` : "—"}</Tile>
            <Tile label="Channel">{c.channel === "PHONE" ? "Phone (Twilio)" : "Demo (browser)"}</Tile>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card
              title={
                <span className="flex items-center gap-2">
                  Conversation transcript
                  {live && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live
                    </span>
                  )}
                </span>
              }
              subtitle={`${detail.turns.length} turns${live ? " · updating every 3s" : ""}`}
            >
              <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                {detail.turns.map((t) => (
                  <div key={t.turnIndex} className="flex gap-3 rounded-lg bg-gray-50 p-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        t.speaker === "AI" ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {t.speaker === "AI" ? <WaveformIcon className="h-4 w-4" /> : <PersonIcon className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">{t.speaker === "AI" ? "VoiceNexus" : "Caller"}</span>
                        <span className="text-xs text-gray-400">
                          {t.latencyMs !== null && t.latencyMs !== undefined && <span className="mr-2 tabular-nums">replied in {(t.latencyMs / 1000).toFixed(1)}s</span>}
                          {formatTime(t.timestamp)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-gray-700">{t.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="space-y-6">
              {detail.escalation && (
                <Card
                  title={
                    <span className="flex items-center justify-between gap-2">
                      Agent handoff
                      <Badge tone={ESCALATION_STATUS_TONES[detail.escalation.status]}>{detail.escalation.status.toLowerCase()}</Badge>
                    </span>
                  }
                >
                  <p className="text-sm text-gray-800">{detail.escalation.summary}</p>
                  {detail.escalation.attempted.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm text-gray-600">
                      {detail.escalation.attempted.map((a) => (
                        <li key={a}>· {a}</li>
                      ))}
                    </ul>
                  )}
                  {detail.escalation.notes && <p className="mt-3 text-sm text-gray-500">Agent notes: “{detail.escalation.notes}”</p>}
                  <Link href="/admin/escalations" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
                    Open escalation queue →
                  </Link>
                </Card>
              )}

              <Card title="Recording">
                {c.hasAudio ? (
                  <audio controls preload="metadata" src={conversationAudioUrl(c.id)} className="w-full" />
                ) : (
                  <p className="text-sm text-gray-500">No recording for this call{c.channel === "DEMO" ? " (mic permission not granted, or the call wasn't ended from the page)" : ""}.</p>
                )}
              </Card>

              <Card title="Actions taken">
                <ul className="space-y-2 text-sm text-gray-700">
                  {actionsTaken(detail).map((a) => (
                    <li key={a.text} className="flex items-start gap-2">
                      <CheckIcon className={`mt-0.5 h-4 w-4 shrink-0 ${a.ok ? "text-green-600" : "text-gray-300"}`} />
                      {a.text}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Details">
                <dl className="space-y-2 text-sm">
                  <Row label="Start time" value={formatDateTime(c.startTime)} />
                  <Row label="End time" value={formatDateTime(c.endTime)} />
                  <Row label="Caller number (ANI)" value={c.ani} />
                  <Row label="BAN provided" value={c.banProvided ?? "—"} />
                  <Row
                    label="Customer"
                    value={
                      c.customerId ? (
                        <Link href={`/admin/customers/${c.customerId}`} className="text-blue-600 hover:text-blue-700">
                          {c.customerName ?? c.customerId}
                        </Link>
                      ) : (
                        "Not identified"
                      )
                    }
                  />
                  <Row label="PIN attempts" value={String(detail.authSession?.pinAttempts ?? 0)} />
                  {c.escalationReason && <Row label="Escalation reason" value={ESCALATION_REASON_LABELS[c.escalationReason]} />}
                </dl>
                {detail.otps.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">One-time codes</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
                      {detail.otps.map((o, i) => (
                        <li key={i} className="flex items-center justify-between gap-2">
                          <span>
                            {o.method === "EMAIL" ? "Email" : "SMS"} → {o.destinationMasked}
                          </span>
                          <Badge tone={o.status === "VERIFIED" ? "success" : o.status === "FAILED" ? "danger" : "neutral"}>{o.status.toLowerCase()}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}

// Derived from recorded state only (no AI summary) — each line maps to something the server did.
function actionsTaken({ conversation: c, otps, actions, escalation }: ConversationDetail) {
  const list: { text: string; ok: boolean }[] = [];
  list.push({ text: c.banProvided ? `Captured account number ${c.banProvided}` : "No account number captured", ok: Boolean(c.banProvided) });
  if (c.customerId) list.push({ text: `Matched account to ${c.customerName ?? c.customerId}`, ok: true });
  if (otps.length > 0) list.push({ text: `Sent ${otps.length} one-time code${otps.length > 1 ? "s" : ""}`, ok: true });
  if (c.authStatus === "SUCCESS") list.push({ text: `Verified caller identity (${c.authMethod ? AUTH_METHOD_LABELS[c.authMethod] : "—"})`, ok: true });
  if (c.authStatus === "FAILED") list.push({ text: "Verification failed", ok: false });
  for (const a of actions) {
    const verb = a.status === "CANCELLED" ? " (cancelled)" : a.status === "SCHEDULED" ? " (scheduled)" : "";
    list.push({ text: `${ACTION_LABELS[a.type]}: ${a.description}${verb}`, ok: a.status !== "CANCELLED" });
  }
  if (escalation) list.push({ text: `Handed off to a live agent: ${ESCALATION_REASON_LABELS[escalation.reason] ?? escalation.reason}`, ok: false });
  if (c.authStatus === "SUCCESS" && c.detectedIntent && c.detectedIntent !== "UNKNOWN" && actions.length === 0 && !escalation) {
    list.push({ text: `Answered request: ${intentLabel(c.detectedIntent)}`, ok: true });
  }
  return list;
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-32 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-gray-900">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{value}</dd>
    </div>
  );
}
