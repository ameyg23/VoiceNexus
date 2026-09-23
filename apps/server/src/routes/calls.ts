import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { advanceAuthSession } from "../lib/authStateMachine.js";
import { saveRecording } from "../lib/recordings.js";
import { startConversation, appendTurn, endConversation, conversationExists, GREETING } from "../lib/conversations.js";

export const callsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const startSchema = z.object({ demoPhoneNumber: z.string().min(1) });

// POST /api/calls/start — demoPhoneNumber only sets the ANI, never auth state
// (ARCHITECTURE.md §18: ANI != authentication).
callsRouter.post("/start", (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversationId = startConversation(parsed.data.demoPhoneNumber, "DEMO");
  res.json({ conversationId, aiText: GREETING, stage: "AWAITING_INTENT", authStatus: "PENDING" });
});

const turnSchema = z.object({ text: z.string().min(1) });

// POST /api/calls/:id/turn — runs the customer's utterance through the Auth State
// Machine. Server independently validates every extracted value against the DB.
callsRouter.post("/:id/turn", async (req, res) => {
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversationId = req.params.id;
  if (!conversationExists(conversationId)) return res.status(404).json({ error: "conversation not found" });

  appendTurn(conversationId, "CUSTOMER", parsed.data.text);

  let result;
  try {
    result = await advanceAuthSession(conversationId, parsed.data.text);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "auth state machine error" });
  }

  appendTurn(conversationId, "AI", result.aiText);

  res.json({ aiText: result.aiText, stage: result.stage, authStatus: result.authStatus });
});

// POST /api/calls/:id/audio — multipart upload of the recorded call audio (ARCHITECTURE.md §13).
// Stored under storage/recordings/{conversationId}.webm, linked via conversations.audio_path.
callsRouter.post("/:id/audio", upload.single("audio"), (req, res) => {
  const conversationId = req.params.id;
  if (!conversationExists(conversationId)) return res.status(404).json({ error: "conversation not found" });

  if (!req.file) return res.status(400).json({ error: "no audio file provided (expected field 'audio')" });

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
