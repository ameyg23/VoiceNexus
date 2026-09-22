import { Router } from "express";
import { z } from "zod";
import { db } from "@voice-nexus/db";
import { nextConversationId } from "../lib/ids.js";
import { advanceAuthSession } from "../lib/authStateMachine.js";

export const callsRouter = Router();

const startSchema = z.object({ demoPhoneNumber: z.string().min(1) });

// POST /api/calls/start — demoPhoneNumber only sets the ANI, never auth state
// (ARCHITECTURE.md §18: ANI != authentication).
callsRouter.post("/start", (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversationId = nextConversationId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, customer_id, ani, auth_status, status, start_time)
    VALUES (@id, NULL, @ani, 'PENDING', 'IN_PROGRESS', @now)
  `).run({ "@id": conversationId, "@ani": parsed.data.demoPhoneNumber, "@now": now });

  db.prepare(`
    INSERT INTO auth_sessions (conversation_id, stage, customer_id, pin_attempts)
    VALUES (@cid, 'AWAITING_INTENT', NULL, 0)
  `).run({ "@cid": conversationId });

  const greeting = "Thanks for calling the care line. What can I help you with today?";
  appendTurn(conversationId, "AI", greeting);

  res.json({ conversationId, aiText: greeting, stage: "AWAITING_INTENT", authStatus: "PENDING" });
});

const turnSchema = z.object({ text: z.string().min(1) });

// POST /api/calls/:id/turn — runs the customer's utterance through the Auth State
// Machine. Server independently validates every extracted value against the DB.
callsRouter.post("/:id/turn", (req, res) => {
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversationId = req.params.id;
  const conversation = db.prepare(`SELECT id FROM conversations WHERE id = @id`).get({ "@id": conversationId });
  if (!conversation) return res.status(404).json({ error: "conversation not found" });

  appendTurn(conversationId, "CUSTOMER", parsed.data.text);

  let result;
  try {
    result = advanceAuthSession(conversationId, parsed.data.text);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "auth state machine error" });
  }

  appendTurn(conversationId, "AI", result.aiText);

  res.json({ aiText: result.aiText, stage: result.stage, authStatus: result.authStatus });
});

// POST /api/calls/:id/end — finalizes conversation, computes duration.
callsRouter.post("/:id/end", (req, res) => {
  const conversationId = req.params.id;
  const conversation = db.prepare(`SELECT start_time FROM conversations WHERE id = @id`).get({
    "@id": conversationId,
  }) as { start_time: string } | undefined;
  if (!conversation) return res.status(404).json({ error: "conversation not found" });

  const endTime = new Date();
  const durationSeconds = Math.round((endTime.getTime() - new Date(conversation.start_time).getTime()) / 1000);

  db.prepare(`
    UPDATE conversations SET status = 'COMPLETED', end_time = @endTime, duration_seconds = @duration WHERE id = @id
  `).run({ "@endTime": endTime.toISOString(), "@duration": durationSeconds, "@id": conversationId });

  res.json({ conversationId, durationSeconds });
});

function appendTurn(conversationId: string, speaker: "AI" | "CUSTOMER", text: string) {
  const row = db.prepare(`SELECT COALESCE(MAX(turn_index), -1) + 1 as nextIndex FROM transcript_turns WHERE conversation_id = @cid`).get({
    "@cid": conversationId,
  }) as { nextIndex: number };

  db.prepare(`
    INSERT INTO transcript_turns (conversation_id, turn_index, speaker, text) VALUES (@cid, @idx, @speaker, @text)
  `).run({ "@cid": conversationId, "@idx": row.nextIndex, "@speaker": speaker, "@text": text });
}
