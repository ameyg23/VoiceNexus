"use client";

import { useEffect, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { fetchCustomerVoiceToken, fetchPublicVoiceToken } from "../lib/api";
import { formatDuration } from "../lib/format";
import { PhoneIcon, PhoneEndIcon, MicIcon } from "./icons";

// Real WebRTC calling from the customer portal, straight to the care line's IVR (user request, Sep
// 29 — supersedes the earlier "number only, no customer-scoped browser calling" decision). Mirrors
// /admin/test-call's Voice JS SDK plumbing but: customer-auth token (GET /api/twilio/customer-token),
// always "direct" mode (no PSTN hairpin choice — a customer just wants to reach the assistant, not
// exercise the raw number's own webhook, and this sidesteps the trial-account hairpin disclaimer
// entirely), and no employee-only "latest call" lookup on hang-up. Being logged into the portal does
// NOT skip phone-side identity verification — the call still asks for BAN+PIN/OTP like any other
// caller (ANI/WebRTC identity stays display-only, ARCHITECTURE.md §18).

type Phase = "idle" | "connecting" | "ringing" | "in-call" | "ended";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  connecting: "Connecting…",
  ringing: "Ringing…",
  "in-call": "In call",
  ended: "Call ended",
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// `audience` picks which token endpoint backs the call: "customer" (default, portal — requireCustomerAuth,
// no per-IP limit needed since a real account already gates it) or "public" (anonymous homepage visitor —
// rate-limited by IP server-side instead, see routes/twilio.ts).
export function CustomerCallWidget({
  careLineNumber,
  audience = "customer",
}: {
  careLineNumber: string | null;
  audience?: "customer" | "public";
}) {
  const fetchToken = audience === "public" ? fetchPublicVoiceToken : fetchCustomerVoiceToken;
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [digits, setDigits] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (phase !== "in-call" || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  useEffect(() => () => deviceRef.current?.destroy(), []);

  useEffect(() => {
    if (phase !== "in-call") return;
    function handleKeyDown(e: KeyboardEvent) {
      if (KEYS.includes(e.key)) {
        e.preventDefault();
        press(e.key);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function getDevice(): Promise<Device> {
    if (deviceRef.current) return deviceRef.current;
    const { token } = await fetchToken();
    // Imported lazily: the SDK touches browser-only APIs at load time.
    const { Device, Call } = await import("@twilio/voice-sdk");
    const device = new Device(token, { codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU], logLevel: "warn" });
    device.on("tokenWillExpire", async () => device.updateToken((await fetchToken()).token));
    device.on("error", (err: { message?: string }) => setError(`Call error: ${err.message ?? String(err)}`));
    deviceRef.current = device;
    return device;
  }

  async function placeCall() {
    setError(null);
    setDigits("");
    setMuted(false);
    setPhase("connecting");
    try {
      const device = await getDevice();
      const call = await device.connect({ params: { mode: "direct" } });
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
      };
      call.on("disconnect", onEnd);
      call.on("cancel", onEnd);
      call.on("reject", onEnd);
      call.on("error", (err: { message?: string }) => setError(`Call error: ${err.message ?? String(err)}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("503")) setError("Browser calling isn't set up for this deployment yet. Please try again later.");
      else if (message.startsWith("429")) setError("Too many call attempts. Please try again in a few minutes.");
      else setError(message);
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

  if (!careLineNumber) {
    return <p className="mt-2 text-sm text-white/80">The care line isn't configured for this deployment yet.</p>;
  }

  return (
    <div>
      {/* Hidden once the dial screen is open - redundant there and it was floating misaligned above the
          phone card instead of relating to anything (user feedback, Oct 4, from a screenshot). Idle and
          ended still show it, since that's the only place it's the only piece of information on offer. */}
      {!live && <p className="mt-1 text-3xl font-bold tabular-nums">{careLineNumber}</p>}

      {error && <p className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 text-xs text-white">{error}</p>}

      {phase === "idle" && (
        <button onClick={() => void placeCall()} className="btn mt-4 bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-white/90">
          Call now
        </button>
      )}

      {live && (
        // A self-contained "phone card" rather than loose circles floating in the much wider marketing
        // card around it (user feedback, Oct 4: centering alone still left dead space either side since
        // the outer card is sized for the page section, not for a compact dial screen). The darker inset
        // panel gives the call UI its own visual boundary, same idea as an actual phone's call screen.
        // Widened and the keypad enlarged (user feedback, same day) so the panel doesn't look sparse.
        <div className="mx-auto w-full max-w-sm rounded-2xl bg-black/15 p-6 ring-1 ring-white/10">
          <div className="flex flex-col items-center text-center">
            <div className="relative flex h-16 w-16 items-center justify-center">
              {phase !== "in-call" && <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />}
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/15">
                <PhoneIcon className="h-6 w-6" />
              </span>
            </div>
            <span className="mt-3 text-xs font-semibold uppercase tracking-wide text-white/70">{PHASE_LABEL[phase]}</span>
            <span className="mt-1 text-2xl font-semibold tabular-nums">{phase === "in-call" ? formatDuration(elapsed) : "00:00"}</span>
            <p className="mt-1 h-5 text-sm tracking-[0.3em] text-white/70 tabular-nums">{digits}</p>

            <div className="mt-5 grid grid-cols-3 gap-4">
              {KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => press(k)}
                  disabled={phase !== "in-call"}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-lg font-medium text-white transition hover:bg-white/20 disabled:opacity-30"
                >
                  {k}
                </button>
              ))}
            </div>
            {phase === "in-call" && <p className="mt-3 text-center text-[11px] text-white/50">Or use your keyboard: 0-9, *, #</p>}

            <div className="mt-6 flex items-center gap-8">
              <button
                onClick={toggleMute}
                disabled={phase !== "in-call"}
                aria-label={muted ? "Unmute" : "Mute"}
                className={`flex h-14 w-14 items-center justify-center rounded-full border transition disabled:opacity-30 ${
                  muted ? "border-white bg-white text-brand-700" : "border-white/30 text-white hover:bg-white/10"
                }`}
              >
                <MicIcon className="h-6 w-6" />
              </button>
              <button
                onClick={hangUp}
                aria-label="Hang up"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-black/20 transition hover:bg-red-500 active:scale-95"
              >
                <PhoneEndIcon className="h-7 w-7" />
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "ended" && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm text-white/85">Call ended{elapsed ? ` (${formatDuration(elapsed)})` : ""}.</p>
          <button onClick={() => setPhase("idle")} className="text-sm font-semibold underline">
            Call again
          </button>
        </div>
      )}
    </div>
  );
}
