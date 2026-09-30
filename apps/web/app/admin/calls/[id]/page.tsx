"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { conversationAudioUrl, fetchConversation, fetchDevOtp, type ConversationDetail } from "../../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../../components/AdminShell";
import { Badge } from "../../../../components/Badge";
import { CheckIcon, PersonIcon, WaveformIcon } from "../../../../components/icons";
import {
  ACTION_LABELS,
  AUTH_METHOD_LABELS,
  ESCALATION_REASON_LABELS,
  ESCALATION_STATUS_TONES,
  INTENT_PHRASES,
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
  // Dev-only: reveal the plaintext OTP for local testing (the audit trail above only ever shows the
  // masked destination + status). Replaces the old standalone /demo/otp-console page.
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [devOtpError, setDevOtpError] = useState<string | null>(null);

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

  async function handleRevealOtp() {
    setDevOtpError(null);
    try {
      const { code } = await fetchDevOtp(id);
      setDevOtp(code);
    } catch {
      setDevOtpError("No pending code for this call.");
    }
  }

  return (
    <AdminShell
      title={`Call Details: ${id}`}
      subtitle={
        <Link href="/admin/calls" className="font-medium text-brand-600 hover:text-brand-700">
          ← All calls
        </Link>
      }
      actions={
        c?.hasAudio && (
          <a href={conversationAudioUrl(c.id)} download={c.id} className="btn btn-secondary px-4 py-2.5 text-sm">
            ⇩ Download
          </a>
        )
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
            <Tile label="Resolved by">{c.outcome === "ESCALATED" ? "Agent" : c.outcome === "CALLBACK" ? "Callback" : c.outcome === "RESOLVED" ? "VoiceNexus" : "-"}</Tile>
            <Tile label="Verified by">{c.authMethod ? AUTH_METHOD_LABELS[c.authMethod] : "Not verified"}</Tile>
            <Tile label="CSAT">{c.csatScore ? `${c.csatScore}/5` : "-"}</Tile>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <Card
              title={
                <span className="flex items-center gap-2">
                  Conversation Transcript
                  {live && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live
                    </span>
                  )}
                </span>
              }
              subtitle={live ? "Updating every 3 seconds" : undefined}
            >
              <div className="max-h-[40rem] space-y-3 overflow-y-auto pr-2">
                {detail.turns.map((t) => (
                  <div key={t.turnIndex} className="flex gap-3">
                    <div
                      className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        t.speaker === "AI" ? "bg-brand-100 text-brand-700" : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {t.speaker === "AI" ? <WaveformIcon className="h-4 w-4" /> : <PersonIcon className="h-4 w-4" />}
                    </div>
                    <div className={`min-w-0 flex-1 rounded-xl px-4 py-3 ${t.speaker === "AI" ? "bg-gray-100" : "bg-gray-50 ring-1 ring-inset ring-gray-200"}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-900">{t.speaker === "AI" ? "VoiceNexus" : "Caller"}</span>
                        <span className="text-[11px] text-gray-400">
                          {t.latencyMs !== null && t.latencyMs !== undefined && <span className="mr-2 tabular-nums">replied in {(t.latencyMs / 1000).toFixed(1)}s</span>}
                          {formatTime(t.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-[15px] leading-relaxed text-gray-800">{t.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="space-y-6">
              <Card title="AI Insights">
                <Section title="AI Summary">
                  <p className="text-sm leading-relaxed text-gray-700">{summaryOf(detail)}</p>
                </Section>
                <Section title="AI Actions Taken">
                  <ul className="space-y-2.5 text-sm text-gray-700">
                    {actionsTaken(detail).map((a) => (
                      <li key={a.text} className="flex items-start gap-2">
                        <CheckIcon className={`mt-0.5 h-4 w-4 shrink-0 ${a.ok ? "text-green-600" : "text-gray-300"}`} />
                        {a.text}
                      </li>
                    ))}
                  </ul>
                </Section>
                <Section title="Details" last>
                  <dl className="space-y-2.5 text-sm">
                    <Row label="Start Time" value={formatDateTime(c.startTime)} />
                    <Row label="End Time" value={formatDateTime(c.endTime)} />
                    <Row label="Outcome" value={OUTCOME_LABELS[c.outcome]} />
                    <Row label="Caller number" value={c.ani} />
                    <Row label="Account (BAN)" value={c.banProvided ?? "-"} />
                    <Row
                      label="Customer"
                      value={
                        c.customerId ? (
                          <Link href={`/admin/customers/${c.customerId}`} className="font-medium text-brand-600 hover:text-brand-700">
                            {c.customerName ?? c.customerId}
                          </Link>
                        ) : (
                          "Not identified"
                        )
                      }
                    />
                    <Row label="Channel" value={c.channel === "PHONE" ? "Phone (Twilio)" : "Demo (browser)"} />
                    <Row label="Account number attempts" value={String(detail.authSession?.banAttempts ?? 0)} />
                    <Row label="PIN attempts" value={String(detail.authSession?.pinAttempts ?? 0)} />
                    {c.escalationReason && <Row label="Escalation reason" value={ESCALATION_REASON_LABELS[c.escalationReason]} />}
                  </dl>
                  {detail.otps.length > 0 && (
                    <div className="mt-4 space-y-1.5 text-sm">
                      {detail.otps.map((o, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-gray-600">
                            {o.method === "EMAIL" ? "Email" : "SMS"} code → {o.destinationMasked}
                          </span>
                          <Badge tone={o.status === "VERIFIED" ? "success" : o.status === "FAILED" ? "danger" : "neutral"}>{o.status.toLowerCase()}</Badge>
                        </div>
                      ))}
                      {process.env.NEXT_PUBLIC_DEMO_MODE === "true" && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <span className="font-medium">Dev:</span>
                          {devOtp ? (
                            <span className="font-mono text-sm font-semibold">{devOtp}</span>
                          ) : (
                            <button onClick={() => void handleRevealOtp()} className="font-medium underline hover:text-amber-900">
                              Reveal code
                            </button>
                          )}
                          {devOtpError && <span>{devOtpError}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              </Card>

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
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <RoutingFact label="Caller's topic" value={intentLabel(detail.escalation.intent)} />
                    <RoutingFact label="Routed to" value={detail.escalation.routingCode ?? "-"} mono />
                    <RoutingFact label="Should've been" value={detail.escalation.expectedRoutingCode} mono />
                  </div>
                  {detail.escalation.routingCode && (
                    <Badge tone={detail.escalation.routingMatch ? "success" : "danger"}>
                      {detail.escalation.routingMatch ? "Routed correctly" : "Misrouted"}
                    </Badge>
                  )}
                  {detail.escalation.notes && <p className="mt-3 text-sm text-gray-500">Agent notes: “{detail.escalation.notes}”</p>}
                  <Link href="/admin/escalations" className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:text-brand-700">
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
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}

// Plain-language recap assembled from recorded facts only (no AI), so it can't state anything that
// didn't happen.
function summaryOf({ conversation: c, actions, escalation }: ConversationDetail): string {
  const parts: string[] = [];
  parts.push(
    c.detectedIntent && c.detectedIntent !== "UNKNOWN"
      ? `The caller wanted help with ${INTENT_PHRASES[c.detectedIntent]}.`
      : "The caller's request wasn't clearly identified."
  );
  if (c.authStatus === "SUCCESS") parts.push(`The AI verified their identity by ${c.authMethod ? AUTH_METHOD_LABELS[c.authMethod] : "PIN"}${c.customerName ? ` (${c.customerName})` : ""}.`);
  else if (c.authStatus === "FAILED") parts.push("The caller could not be verified.");
  else if (c.banProvided) parts.push("The caller gave an account number but didn't finish verification.");
  const done = actions.filter((a) => a.status !== "CANCELLED").map((a) => a.description.charAt(0).toLowerCase() + a.description.slice(1));
  if (done.length) parts.push(`It ${done.join(", and ")}.`);
  if (escalation) parts.push(`The call was handed to a live agent (${(ESCALATION_REASON_LABELS[escalation.reason] ?? escalation.reason).toLowerCase()}).`);
  else if (c.outcome === "RESOLVED") parts.push("The request was resolved without a live agent.");
  else if (c.outcome === "CALLBACK") parts.push("A callback was scheduled to follow up.");
  else if (c.outcome === "ABANDONED") parts.push("The call ended before it was resolved.");
  else if (c.outcome === "IN_PROGRESS") parts.push("The call is still in progress.");
  if (c.csatScore) parts.push(`The caller rated the call ${c.csatScore}/5.`);
  return parts.join(" ");
}

// Derived from recorded state only — each line maps to something the server did.
function actionsTaken({ conversation: c, otps, actions, escalation }: ConversationDetail) {
  const list: { text: string; ok: boolean }[] = [];
  list.push({ text: c.banProvided ? `Captured account number ${c.banProvided}` : "No account number captured", ok: Boolean(c.banProvided) });
  if (otps.length > 0) list.push({ text: `Sent ${otps.length} one-time code${otps.length > 1 ? "s" : ""}`, ok: true });
  if (c.authStatus === "SUCCESS") list.push({ text: "Verified caller identity", ok: true });
  if (c.authStatus === "FAILED") list.push({ text: "Verification failed", ok: false });
  for (const a of actions) {
    const suffix = a.status === "CANCELLED" ? " (cancelled)" : a.status === "SCHEDULED" ? " (scheduled)" : "";
    list.push({ text: `${ACTION_LABELS[a.type]}: ${a.description}${suffix}`, ok: a.status !== "CANCELLED" });
  }
  if (escalation) list.push({ text: "Handed off to a live agent with a summary", ok: true });
  if (c.authStatus === "SUCCESS" && c.detectedIntent && c.detectedIntent !== "UNKNOWN" && actions.length === 0 && !escalation) {
    list.push({ text: `Answered: ${intentLabel(c.detectedIntent)}`, ok: true });
  }
  return list;
}

function Section({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-5 border-b border-gray-100 pb-5"}>
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      {children}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-32 rounded-2xl border border-gray-200/80 bg-white px-5 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <div className="mt-1.5 text-[15px] font-semibold text-gray-900">{children}</div>
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

function RoutingFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold text-gray-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
