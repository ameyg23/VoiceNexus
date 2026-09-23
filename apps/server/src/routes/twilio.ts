// Real telephony adapter (ARCHITECTURE.md §19): the Twilio care line drives the SAME conversation
// lifecycle and Auth State Machine as the browser demo — only the audio I/O boundary differs.
//
// Speech-to-text and text-to-speech use Twilio's own <Gather input="speech"> and <Say> rather than
// Media Streams + a separate streaming STT vendor: it's turn-based exactly like the demo's
// /api/calls/:id/turn loop, needs no extra account/API key, and bills against the same trial credit.
// Callers can also key digits (BAN/PIN/OTP) on the keypad — DTMF arrives as `Digits`.
//
// Endpoints (all Twilio-signed, form-encoded):
//   POST /api/twilio/voice        care-line number's "A call comes in" webhook
//   POST /api/twilio/gather       each <Gather> result (one caller turn)
//   POST /api/twilio/pending      polled via <Redirect> while a slow AI turn finishes
//   POST /api/twilio/status       number's call status callback → finalize the conversation
//   POST /api/twilio/recording    <Start><Recording> status callback → download the mp3
//   POST /api/twilio/client-voice TwiML App voice URL for browser (Voice JS SDK) calls
// Plus GET /api/twilio/token (employee-only), the Voice SDK access token for the test-call page.

import express, { Router, type Request, type Response, type NextFunction } from "express";
import twilio from "twilio";
import { db } from "@voice-nexus/db";
import { advanceAuthSession, type TurnResult } from "../lib/authStateMachine.js";
import { startConversation, appendTurn, endConversation, greetingText } from "../lib/conversations.js";
import { getSettings, toSpeech } from "../lib/settings.js";
import { saveRecording } from "../lib/recordings.js";
import { requireEmployeeAuth } from "../lib/auth.js";

const { VoiceResponse } = twilio.twiml;

export const twilioRouter = Router();
twilioRouter.use(express.urlencoded({ extended: false }));

const SPEECH_HINTS =
  "account number, BAN, PIN, resend, balance, payment, due date, payment arrangement, plan, upgrade, autopay, internet, outage, technician, callback, agent, yes, no, goodbye";
// Twilio abandons a webhook after 15s. A turn can make several Gemini calls (each with its own
// timeout + retry), so we answer within this budget and, if the turn isn't done, keep the caller on
// the line with a short pause + <Redirect> to /pending until it is.
const TURN_BUDGET_MS = 9000;
const MAX_SILENT_PROMPTS = 2;

function publicUrl(path: string): string {
  return `${(process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "")}${path}`;
}

// Twilio signs each request over the exact public URL it called plus the POST params. Behind ngrok
// the Host header isn't reliable, so we sign against PUBLIC_BASE_URL.
function validateTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !process.env.PUBLIC_BASE_URL) {
    return res.status(503).type("text/plain").send("Twilio webhooks not configured (TWILIO_AUTH_TOKEN / PUBLIC_BASE_URL)");
  }
  const signature = req.header("X-Twilio-Signature") ?? "";
  if (!twilio.validateRequest(authToken, signature, publicUrl(req.originalUrl), req.body ?? {})) {
    console.warn(`[twilio] rejected unsigned/invalid request to ${req.originalUrl}`);
    return res.status(403).type("text/plain").send("invalid Twilio signature");
  }
  next();
}

function sendTwiml(res: Response, twiml: InstanceType<typeof VoiceResponse>) {
  res.type("text/xml").send(twiml.toString());
}

type SayTarget = InstanceType<typeof VoiceResponse> | ReturnType<InstanceType<typeof VoiceResponse>["gather"]>;
type SayAttrs = Parameters<InstanceType<typeof VoiceResponse>["say"]>[0];

// Brand voice + language from tenant settings, with pronunciation overrides applied to what's spoken
// (the transcript keeps the original text) — PRD VN-7.
function say(twiml: SayTarget, text: string) {
  const s = getSettings();
  twiml.say({ voice: s.phoneVoice, language: s.language } as SayAttrs, toSpeech(text, s));
}

// Speak `text` inside a <Gather> so the caller can barge in, and loop back to /gather either way
// (actionOnEmptyResult) so silence is handled server-side too.
function promptAndListen(twiml: InstanceType<typeof VoiceResponse>, text: string, silentPrompts = 0) {
  const gather = twiml.gather({
    input: ["speech", "dtmf"],
    action: publicUrl(`/api/twilio/gather?silent=${silentPrompts}`),
    method: "POST",
    speechTimeout: "auto",
    timeout: 6,
    language: getSettings().language as "en-US",
    hints: SPEECH_HINTS,
    actionOnEmptyResult: true,
  });
  say(gather, text);
}

function speakResult(res: Response, conversationId: string, result: TurnResult) {
  const twiml = new VoiceResponse();
  const agentLine = getSettings().agentTransferNumber;
  if (result.transfer && agentLine) {
    // Live-agent transfer: the structured handoff is already in the escalation queue (VN-5).
    say(twiml, result.aiText);
    twiml.dial({ callerId: process.env.TWILIO_CARE_LINE_NUMBER || undefined }).number(agentLine);
    endConversation(conversationId);
  } else if (result.endCall) {
    say(twiml, result.aiText);
    twiml.hangup();
    endConversation(conversationId);
  } else {
    promptAndListen(twiml, result.aiText);
  }
  sendTwiml(res, twiml);
}

function conversationForCall(callSid: string | undefined): string | null {
  if (!callSid) return null;
  const row = db.prepare(`SELECT id FROM conversations WHERE twilio_call_sid = @sid`).get({ "@sid": callSid }) as { id: string } | undefined;
  return row?.id ?? null;
}

function hangUpWith(res: Response, text: string) {
  const twiml = new VoiceResponse();
  say(twiml, text);
  twiml.hangup();
  sendTwiml(res, twiml);
}

// Starts (or, on a Twilio retry of the same CallSid, resumes) the conversation and greets the caller.
// ANI is the caller's number — display-only, never used for auth (ARCHITECTURE.md §18).
async function answerCall(req: Request, res: Response, ani: string) {
  const callSid: string = req.body.CallSid;
  const existing = conversationForCall(callSid);
  const greeting = await greetingText();
  const conversationId = existing ?? startConversation(ani, "PHONE", greeting, callSid);
  if (!existing) console.log(`[twilio] call ${callSid} from ${ani} → ${conversationId}`);

  const twiml = new VoiceResponse();
  // Native Twilio recording replaces the browser MediaRecorder for phone calls (ARCHITECTURE.md §19),
  // unless operations has switched recording off (compliance — PRD §9).
  if (getSettings().recordingEnabled) {
    twiml.start().recording({
      channels: "dual",
      recordingStatusCallback: publicUrl("/api/twilio/recording"),
      recordingStatusCallbackEvent: ["completed"],
    });
  }
  promptAndListen(twiml, greeting);
  sendTwiml(res, twiml);
}

twilioRouter.post("/voice", validateTwilioSignature, async (req, res) => {
  await answerCall(req, res, req.body.From ?? "unknown");
});

// In-flight turns keyed by CallSid, so /pending can pick up a turn that outlived TURN_BUDGET_MS.
const pendingTurns = new Map<string, Promise<TurnResult>>();

async function respondWithinBudget(res: Response, callSid: string, conversationId: string, alreadyHeld = false) {
  const turn = pendingTurns.get(callSid);
  if (!turn) {
    // Nothing in flight (e.g. server restarted mid-turn) — just listen again.
    const twiml = new VoiceResponse();
    promptAndListen(twiml, "Sorry, could you say that again?");
    return sendTwiml(res, twiml);
  }

  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), TURN_BUDGET_MS));
  const outcome = await Promise.race([turn, timeout]);
  if (outcome === "timeout") {
    const twiml = new VoiceResponse();
    // The operator's hold prompt (VN-9), once per slow turn, then silence while it finishes.
    if (!alreadyHeld) say(twiml, getSettings().holdPrompt);
    else twiml.pause({ length: 1 });
    twiml.redirect({ method: "POST" }, publicUrl("/api/twilio/pending?held=1"));
    return sendTwiml(res, twiml);
  }

  pendingTurns.delete(callSid);
  speakResult(res, conversationId, outcome);
}

twilioRouter.post("/gather", validateTwilioSignature, async (req, res) => {
  const callSid: string = req.body.CallSid;
  const conversationId = conversationForCall(callSid);
  if (!conversationId) return hangUpWith(res, "Sorry, something went wrong with this call. Please call back.");

  // `||` not `??`: Twilio can send an empty SpeechResult alongside keypad Digits.
  const utterance = String(req.body.SpeechResult || req.body.Digits || "").trim();
  if (!utterance) {
    const silent = Number(req.query.silent ?? 0) + 1;
    if (silent > MAX_SILENT_PROMPTS) {
      const bye = "I haven't heard anything, so I'll end the call here. Please call back any time.";
      appendTurn(conversationId, "AI", bye);
      endConversation(conversationId);
      return hangUpWith(res, bye);
    }
    const twiml = new VoiceResponse();
    promptAndListen(twiml, "Sorry, I didn't hear anything. Are you still there?", silent);
    return sendTwiml(res, twiml);
  }

  appendTurn(conversationId, "CUSTOMER", utterance);
  const started = Date.now();
  const turn = advanceAuthSession(conversationId, utterance)
    .catch((err): TurnResult => {
      console.error(err);
      return { aiText: "Sorry, I ran into a problem. Could you say that again?", stage: "AWAITING_INTENT", authStatus: "PENDING" };
    })
    .then((result) => {
      appendTurn(conversationId, "AI", result.aiText, Date.now() - started);
      return result;
    });
  pendingTurns.set(callSid, turn);

  await respondWithinBudget(res, callSid, conversationId);
});

twilioRouter.post("/pending", validateTwilioSignature, async (req, res) => {
  const callSid: string = req.body.CallSid;
  const conversationId = conversationForCall(callSid);
  if (!conversationId) return hangUpWith(res, "Sorry, something went wrong with this call. Please call back.");
  await respondWithinBudget(res, callSid, conversationId, req.query.held === "1");
});

const FINAL_CALL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

twilioRouter.post("/status", validateTwilioSignature, (req, res) => {
  const conversationId = conversationForCall(req.body.CallSid);
  if (conversationId && FINAL_CALL_STATUSES.has(req.body.CallStatus)) {
    endConversation(conversationId);
    pendingTurns.delete(req.body.CallSid);
    console.log(`[twilio] ${conversationId} ended (${req.body.CallStatus})`);
  }
  res.sendStatus(204);
});

twilioRouter.post("/recording", validateTwilioSignature, (req, res) => {
  res.sendStatus(204); // ack immediately; download happens after
  const conversationId = conversationForCall(req.body.CallSid);
  if (!conversationId || req.body.RecordingStatus !== "completed" || !req.body.RecordingUrl) return;
  void downloadRecording(conversationId, String(req.body.RecordingUrl));
});

async function downloadRecording(conversationId: string, recordingUrl: string) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  try {
    const res = await fetch(`${recordingUrl}.mp3`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const audioPath = saveRecording(conversationId, Buffer.from(await res.arrayBuffer()), "mp3");
    console.log(`[twilio] saved recording for ${conversationId} → ${audioPath}`);
  } catch (err) {
    console.error(`[twilio] recording download failed for ${conversationId}:`, err);
  }
}

// Browser test calls (Voice JS SDK → TwiML App → here). Default "pstn" mode dials the real care-line
// number, so Sunday's test exercises the number's own webhook exactly like an outside caller. "direct"
// runs the IVR right on the browser leg — a fallback if hairpinning back into our own number misbehaves.
twilioRouter.post("/client-voice", validateTwilioSignature, (req, res) => {
  const careLine = process.env.TWILIO_CARE_LINE_NUMBER;
  if (req.body.mode === "direct" || !careLine) {
    return void answerCall(req, res, String(req.body.From ?? "client:browser"));
  }
  const twiml = new VoiceResponse();
  twiml.dial({ callerId: careLine }).number(careLine);
  sendTwiml(res, twiml);
});

// GET /api/twilio/token — short-lived Voice SDK access token for the employee test-call page. Outgoing
// calls only; the TwiML App decides what they can reach (only the care line).
twilioRouter.get("/token", requireEmployeeAuth, (req, res) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_TWIML_APP_SID) {
    return res.status(503).json({ error: "Voice SDK not configured — run apps/server/scripts/twilio-setup.ts first" });
  }

  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, {
    identity: `employee-${req.employee!.employeeId}`,
    ttl: 3600,
  });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: TWILIO_TWIML_APP_SID, incomingAllow: false }));
  res.json({ token: token.toJwt(), careLineNumber: process.env.TWILIO_CARE_LINE_NUMBER ?? null });
});
