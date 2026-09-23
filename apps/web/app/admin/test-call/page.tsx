"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Call, Device } from "@twilio/voice-sdk";
import { fetchConversations, fetchVoiceToken, type ConversationSummary } from "../../../lib/api";
import { AdminShell, Card, ErrorNote } from "../../../components/AdminShell";
import { Badge, type BadgeTone } from "../../../components/Badge";
import { formatDuration } from "../../../lib/format";

// Places a REAL call from this laptop's mic to the Twilio care line over WebRTC (Voice JS SDK) — no
// phone or carrier involved (CLAUDE.md "Key decisions"). Every call spends Twilio trial credit, so this
// is for Sunday's deliberate end-to-end verification batch only; iterate in /demo/call instead.

type Phase = "idle" | "connecting" | "ringing" | "in-call" | "ended";

const PHASE_BADGE: Record<Phase, { label: string; tone: BadgeTone }> = {
  idle: { label: "Ready", tone: "neutral" },
  connecting: { label: "Connecting…", tone: "info" },
  ringing: { label: "Ringing…", tone: "info" },
  "in-call": { label: "In call", tone: "success" },
  ended: { label: "Call ended", tone: "neutral" },
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export default function TestCallPage() {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"pstn" | "direct">("pstn");
  const [careLine, setCareLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [digits, setDigits] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [latestCall, setLatestCall] = useState<ConversationSummary | null>(null);

  useEffect(() => {
    if (phase !== "in-call" || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => () => deviceRef.current?.destroy(), []);

  async function getDevice(): Promise<Device> {
    if (deviceRef.current) return deviceRef.current;
    const { token, careLineNumber } = await fetchVoiceToken();
    setCareLine(careLineNumber);
    // Imported lazily: the SDK touches browser-only APIs at load time.
    const { Device, Call } = await import("@twilio/voice-sdk");
    const device = new Device(token, { codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU], logLevel: "warn" });
    device.on("tokenWillExpire", async () => device.updateToken((await fetchVoiceToken()).token));
    device.on("error", (err: { message?: string }) => setError(`Twilio device error: ${err.message ?? String(err)}`));
    deviceRef.current = device;
    return device;
  }

  async function placeCall() {
    setError(null);
    setDigits("");
    setMuted(false);
    setLatestCall(null);
    setPhase("connecting");
    try {
      const device = await getDevice();
      const call = await device.connect({ params: { mode } });
      callRef.current = call;
      call.on("ringing", () => setPhase("ringing"));
      call.on("accept", () => {
        setStartedAt(Date.now());
        setElapsed(0);
        setPhase("in-call");
      });
      const onEnd = () => {
        callRef.current = null;
        setPhase("ended");
        // The phone leg's conversation lands in the DB via the webhooks; show the newest one.
        setTimeout(() => {
          fetchConversations({ channel: "PHONE" })
            .then(({ conversations }) => setLatestCall(conversations[0] ?? null))
            .catch(() => {});
        }, 1500);
      };
      call.on("disconnect", onEnd);
      call.on("cancel", onEnd);
      call.on("reject", onEnd);
      call.on("error", (err: { message?: string }) => setError(`Call error: ${err.message ?? String(err)}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.startsWith("503") ? "Browser calling isn't set up yet — run the Twilio setup script (see Integrations)." : message);
      setPhase("idle");
    }
  }

  function hangUp() {
    callRef.current?.disconnect();
  }

  function press(key: string) {
    callRef.current?.sendDigits(key);
    setDigits((d) => d + key);
  }

  function toggleMute() {
    const next = !muted;
    callRef.current?.mute(next);
    setMuted(next);
  }

  const live = phase === "connecting" || phase === "ringing" || phase === "in-call";

  return (
    <AdminShell title="Test call" subtitle="Call the real care line from this browser's microphone.">
      <ErrorNote error={error} />
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This places a <strong>real Twilio call</strong> and spends trial credit. Use it only for the final verification batch — iterate in{" "}
        <Link href="/demo/call" className="font-medium underline">
          Demo Mode
        </Link>{" "}
        instead.
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Care line</p>
              <p className="text-lg font-semibold text-gray-900 tabular-nums">{careLine ?? "—"}</p>
            </div>
            <Badge tone={PHASE_BADGE[phase].tone}>{PHASE_BADGE[phase].label}</Badge>
          </div>

          <p className="mt-4 text-center text-3xl font-semibold text-gray-900 tabular-nums">{phase === "in-call" ? formatDuration(elapsed) : "00:00"}</p>
          <p className="mt-1 h-5 text-center text-sm tracking-widest text-gray-500 tabular-nums">{digits}</p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => press(k)}
                disabled={phase !== "in-call"}
                className="rounded-lg border border-gray-200 bg-gray-50 py-3 text-lg font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-40"
              >
                {k}
              </button>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            {live ? (
              <>
                <button onClick={hangUp} className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white hover:bg-red-700">
                  Hang up
                </button>
                <button
                  onClick={toggleMute}
                  disabled={phase !== "in-call"}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
              </>
            ) : (
              <button onClick={() => void placeCall()} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                Call care line
              </button>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Routing">
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "pstn"} onChange={() => setMode("pstn")} disabled={live} className="mt-1" />
                <span>
                  <span className="font-medium text-gray-900">Dial the care-line number</span> (recommended) — goes through the number's own webhook,
                  exactly like an outside caller.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "direct"} onChange={() => setMode("direct")} disabled={live} className="mt-1" />
                <span>
                  <span className="font-medium text-gray-900">Connect straight to the IVR</span> — fallback if dialing our own number misbehaves. Same
                  IVR, skips the phone-number leg.
                </span>
              </label>
            </div>
          </Card>

          <Card title="How to run the check">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-gray-700">
              <li>Allow the microphone when the browser asks.</li>
              <li>Say what you need (e.g. “I want to check my balance”).</li>
              <li>Give a demo BAN — say it, or type it on the keypad (e.g. 100001, then #).</li>
              <li>Give the PIN / one-time code the same way (Amara Okafor’s PIN is 4821).</li>
              <li>Ask a question, then say “that's all” to end — or hang up.</li>
              <li>Check the call below: transcript, status, and the recording (arrives a few seconds after hang-up).</li>
            </ol>
          </Card>

          {phase === "ended" && (
            <Card title="Result">
              {latestCall ? (
                <p className="text-sm text-gray-700">
                  Latest phone call:{" "}
                  <Link href={`/admin/calls/${latestCall.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                    {latestCall.id}
                  </Link>{" "}
                  ({latestCall.turnCount} transcript turns)
                </p>
              ) : (
                <p className="text-sm text-gray-500">Looking up the call…</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
