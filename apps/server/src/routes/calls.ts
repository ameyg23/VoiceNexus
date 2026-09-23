import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { advanceAuthSession } from "../lib/authStateMachine.js";
import { saveRecording } from "../lib/recordings.js";
import { startConversation, appendTurn, endConversation, conversationExists, conversationStatus, greetingText } from "../lib/conversations.js";
import { getSettings, toSpeech } from "../lib/settings.js";

export const callsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const startSchema = z.object({ demoPhoneNumber: z.string().min(1) });

// POST /api/calls/start — demoPhoneNumber only sets the ANI, never auth state
// (ARCHITECTURE.md §18: ANI != authentication).
// speechText = aiText with the operator's pronunciation overrides applied, for TTS only (VN-7).
callsRouter.post("/start", async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const greeting = await greetingText();
  const conversationId = startConversation(parsed.data.demoPhoneNumber, "DEMO", greeting);
  const settings = getSettings();
  res.json({
    conversationId,
    aiText: greeting,
    speechText: toSpeech(greeting, settings),
    stage: "AWAITING_INTENT",
    authStatus: "PENDING",
    language: settings.language,
    recordingEnabled: settings.recordingEnabled,
  });
});

const turnSchema = z.object({ text: z.string().min(1) });

// POST /api/calls/:id/turn — runs the customer's utterance through the Auth State
// Machine. Server independently validates every extracted value against the DB.
callsRouter.post("/:id/turn", async (req, res) => {
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversationId = req.params.id;
  const status = conversationStatus(conversationId);
  if (!status) return res.status(404).json({ error: "conversation not found" });
  if (status !== "IN_PROGRESS") return res.status(409).json({ error: "this call has ended" });

  appendTurn(conversationId, "CUSTOMER", parsed.data.text);
  const started = Date.now();

  let result;
  try {
    result = await advanceAuthSession(conversationId, parsed.data.text);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "auth state machine error" });
  }

  appendTurn(conversationId, "AI", result.aiText, Date.now() - started);
  // The assistant ended the call (goodbye, handoff): close it server-side so it can't be continued.
  if (result.endCall) endConversation(conversationId);

  res.json({
    aiText: result.aiText,
    speechText: toSpeech(result.aiText),
    stage: result.stage,
    authStatus: result.authStatus,
    endCall: Boolean(result.endCall),
    transfer: Boolean(result.transfer),
  });
});

// POST /api/calls/:id/audio — multipart upload of the recorded call audio (ARCHITECTURE.md §13).
// Stored under storage/recordings/{conversationId}.webm, linked via conversations.audio_path.
callsRouter.post("/:id/audio", upload.single("audio"), (req, res) => {
  const conversationId = req.params.id;
  if (!conversationExists(conversationId)) return res.status(404).json({ error: "conversation not found" });

  if (!req.file) return res.status(400).json({ error: "no audio file provided (expected field 'audio')" });
  // Recording can be switched off by operations (compliance / data-retention — PRD §9).
  if (!getSettings().recordingEnabled) return res.status(403).json({ error: "call recording is disabled" });

  const audioPath = saveRecording(conversationId, req.file.buffer, "webm");
  res.json({ conversationId, audioPath });
});

// POST /api/calls/:id/end — finalizes conversation, computes duration.
callsRouter.post("/:id/end", (req, res) => {
  const conversationId = req.params.id;
  const result = endConversation(conversationId);
  if (!result) return res.status(404).json({ error: "conversation not found" });
  res.json({ conversationId, durationSeconds: result.durationSeconds });
});
