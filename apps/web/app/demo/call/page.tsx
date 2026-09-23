"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AuthStage, AuthStatus, Language } from "@voice-nexus/shared";
import { endCall, fetchDemoConfig, fetchDemoCustomers, sendTurn, startCall, uploadCallAudio, type DemoCustomer } from "../../../lib/api";
import { TopBar } from "../../../components/TopBar";
import { Badge, type BadgeTone } from "../../../components/Badge";
import { MicIcon, PersonIcon, PhoneEndIcon, SendIcon, WaveformIcon } from "../../../components/icons";

interface TranscriptEntry {
  speaker: "AI" | "CUSTOMER";
  text: string;
  time: string;
}

type CallPhase = "IDLE" | "ACTIVE" | "ENDED";

const STAGE_LABELS: Record<AuthStage, string> = {
  AWAITING_INTENT: "Listening for your request",
  AWAITING_BAN: "Awaiting account number",
  AWAITING_PIN: "Awaiting PIN",
  AWAITING_OTP: "Awaiting one-time code",
  AUTHENTICATED: "Authenticated",
  FAILED: "Authentication failed",
};

const STAGE_TONE: Record<AuthStage, BadgeTone> = {
  AWAITING_INTENT: "info",
  AWAITING_BAN: "info",
  AWAITING_PIN: "info",
  AWAITING_OTP: "info",
  AUTHENTICATED: "success",
  FAILED: "danger",
};

const AUTH_TONE: Record<AuthStatus, BadgeTone> = {
  PENDING: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
};

function now(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DemoCallPage() {
  const [customers, setCustomers] = useState<DemoCustomer[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [phase, setPhase] = useState<CallPhase>("IDLE");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [stage, setStage] = useState<AuthStage | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [manualText, setManualText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  // Tenant settings the call page honours: speech language, and whether recording is allowed.
  const [language, setLanguage] = useState<Language>("en-US");
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  // Why the call ended, when the assistant ended it (goodbye, transfer to an agent, callback booked).
  const [endNote, setEndNote] = useState<string | null>(null);
  const handleEndRef = useRef<(note?: string) => Promise<void>>(async () => {});

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchDemoCustomers()
      .then((c) => {
        setCustomers(c);
        if (c.length > 0) setSelectedId(c[0].id);
      })
      .catch((e) => setError(`Couldn't load demo customers — is the server running? (${String(e)})`));

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setMicSupported(Boolean(SR));
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Speaks with the tenant language; onDone fires when speech finishes (or right away without TTS), so
  // an assistant-ended call only wraps up after the caller has heard the last line.
  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        onDone?.();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      if (onDone) {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            onDone();
          }
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        // Some browsers (and silent tabs) never fire onend — give up after roughly the time it takes to say it.
        setTimeout(finish, Math.min(20000, 2500 + text.length * 70));
      }
      window.speechSynthesis.speak(utterance);
    },
    [language]
  );

  const appendTurn = useCallback((speaker: "AI" | "CUSTOMER", text: string) => {
    setTranscript((prev) => [...prev, { speaker, text, time: now() }]);
  }, []);

  const handleUtterance = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!conversationId || !text) return;

      appendTurn("CUSTOMER", text);
      setIsBusy(true);
      setError(null);
      try {
        const result = await sendTurn(conversationId, text);
        appendTurn("AI", result.aiText);
        setStage(result.stage);
        setAuthStatus(result.authStatus);
        if (result.endCall) {
          const note = result.transfer
            ? "The assistant transferred you to a live agent. The handoff, with a summary of the call, is waiting in the Escalations queue."
            : "The assistant ended the call.";
          speak(result.speechText, () => void handleEndRef.current(note));
        } else {
          speak(result.speechText);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setIsBusy(false);
      }
    },
    [conversationId, appendTurn, speak]
  );

  const handleStart = useCallback(async () => {
    const customer = customers.find((c) => c.id === selectedId);
    if (!customer) return;

    setError(null);
    setTranscript([]);
    setDuration(null);
    audioChunksRef.current = [];

    setEndNote(null);
    // Mic setup runs independently of call start — a slow or never-answered permission prompt
    // must never block the actual conversation (which can proceed via typed input regardless).
    // Skipped entirely when operations has switched call recording off.
    const config = await fetchDemoConfig().catch(() => null);
    const allowRecording = config?.recordingEnabled ?? true;
    setRecordingEnabled(allowRecording);
    if (config) setLanguage(config.language);
    if (allowRecording) navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      })
      .catch(() => {
        setError((prev) => prev ?? "Mic permission denied — call recording will be skipped, but you can still use typed input below.");
      });

    setIsBusy(true);
    try {
      const result = await startCall(customer.phoneNumber);
      setConversationId(result.conversationId);
      setStage(result.stage);
      setAuthStatus(result.authStatus);
      setPhase("ACTIVE");
      setLanguage(result.language);
      appendTurn("AI", result.aiText);
      speak(result.speechText);
      window.localStorage.setItem("vn-last-conversation-id", result.conversationId);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsBusy(false);
    }
  }, [customers, selectedId, appendTurn, speak]);

  const handleListen = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR || isListening || isBusy) return;

    const recognition = new SR();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      void handleUtterance(text);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isListening, isBusy, handleUtterance, language]);

  const handleManualSend = useCallback(() => {
    const text = manualText.trim();
    if (!text) return;
    setManualText("");
    void handleUtterance(text);
  }, [manualText, handleUtterance]);

  const handleEnd = useCallback(async (note?: string) => {
    if (!conversationId) return;
    if (note) setEndNote(note);
    setIsBusy(true);
    setError(null);

    try {
      recognitionRef.current?.stop();

      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        const stopped = new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
        });
        recorder.stop();
        await stopped;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());

      if (audioChunksRef.current.length > 0) {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await uploadCallAudio(conversationId, blob);
      }

      const result = await endCall(conversationId);
      setDuration(result.durationSeconds);
      setPhase("ENDED");
    } catch (e) {
      setError(String(e));
    } finally {
      setIsBusy(false);
    }
  }, [conversationId]);
  handleEndRef.current = handleEnd;

  const handleReset = useCallback(() => {
    setPhase("IDLE");
    setConversationId(null);
    setStage(null);
    setAuthStatus(null);
    setTranscript([]);
    setDuration(null);
    setError(null);
    setEndNote(null);
    audioChunksRef.current = [];
    mediaRecorderRef.current = null;
    streamRef.current = null;
  }, []);

  return (
    <>
      <TopBar eyebrow="Demo call" />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900">Demo Call</h1>
        <p className="mt-1 text-sm text-gray-500">
          Selecting a customer only sets the simulated caller ID (ANI) — you still have to speak your account
          number and PIN/code before any account data is shared.
        </p>

        {!micSupported && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Your browser doesn&apos;t support the Web Speech API (Chrome/Edge only) — use the text box below
            instead of the mic button.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {phase === "IDLE" && (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <label htmlFor="customer" className="mb-2 block text-sm font-medium text-gray-700">
              Select customer (sets simulated caller ID only)
            </label>
            <select
              id="customer"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phoneNumberMasked})
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleStart()}
              disabled={!selectedId || isBusy}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? "Starting…" : "Start Call"}
            </button>
          </div>
        )}

        {phase === "ACTIVE" && conversationId && (
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{conversationId}</Badge>
              {stage && <Badge tone={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</Badge>}
              {authStatus && <Badge tone={AUTH_TONE[authStatus]}>Auth: {authStatus}</Badge>}
            </div>

            <div className="max-h-96 space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              {transcript.map((t, i) => (
                <div key={i} className="flex gap-3 rounded-lg bg-gray-50 p-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      t.speaker === "AI" ? "bg-blue-100 text-blue-600" : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {t.speaker === "AI" ? <WaveformIcon className="h-4 w-4" /> : <PersonIcon className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {t.speaker === "AI" ? "VoiceNexus" : "You"}
                      </span>
                      <span className="text-xs text-gray-400">{t.time}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-700">{t.text}</p>
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={handleListen}
                disabled={!micSupported || isListening || isBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isListening ? "bg-amber-500 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                <MicIcon className="h-4 w-4" />
                {isListening ? "Listening…" : "Speak"}
              </button>
              <input
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleManualSend()}
                placeholder="…or type what you'd say"
                disabled={isBusy}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <button
                onClick={handleManualSend}
                disabled={isBusy || !manualText.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SendIcon className="h-4 w-4" />
                Send
              </button>
            </div>

            <button
              onClick={() => void handleEnd()}
              disabled={isBusy}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PhoneEndIcon className="h-4 w-4" />
              End Call
            </button>
          </div>
        )}

        {phase === "ENDED" && (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            {endNote && <p className="mb-2 text-sm font-medium text-gray-900">{endNote}</p>}
            <p className="text-sm text-gray-700">
              Call ended. Duration: <span className="font-semibold text-gray-900">{duration ?? "—"}s</span>. Final
              stage: <span className="font-semibold text-gray-900">{stage ? STAGE_LABELS[stage] : "—"}</span>.
            </p>
            {!recordingEnabled && <p className="mt-2 text-xs text-gray-500">Call recording is switched off in Settings, so no audio was saved.</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={handleReset}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
              >
                Start another call
              </button>
              {conversationId && (
                <Link href={`/admin/calls/${conversationId}`} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                  View this call in the dashboard →
                </Link>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
