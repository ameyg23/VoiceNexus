// Conversation lifecycle shared by both audio channels — the browser demo (routes/calls.ts) and the
// Twilio care line (routes/twilio.ts). Only the audio I/O differs between them (ARCHITECTURE.md §19);
// creating the conversation, recording transcript turns, and finalizing it are identical.

import { db } from "@voice-nexus/db";
import type { Channel } from "@voice-nexus/shared";
import { nextConversationId } from "./ids.js";

export const GREETING = "Thanks for calling the care line. What can I help you with today?";

// ANI is display-only and never grants auth (ARCHITECTURE.md §18) — the auth session always
// starts at AWAITING_INTENT, exactly as for an unknown caller.
export function startConversation(ani: string, channel: Channel, twilioCallSid?: string): string {
  const conversationId = nextConversationId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversations (id, customer_id, ani, auth_status, status, start_time, channel, twilio_call_sid)
    VALUES (@id, NULL, @ani, 'PENDING', 'IN_PROGRESS', @now, @channel, @sid)
  `).run({ "@id": conversationId, "@ani": ani, "@now": now, "@channel": channel, "@sid": twilioCallSid ?? null });

  db.prepare(`
    INSERT INTO auth_sessions (conversation_id, stage, customer_id, pin_attempts)
    VALUES (@cid, 'AWAITING_INTENT', NULL, 0)
  `).run({ "@cid": conversationId });

  appendTurn(conversationId, "AI", GREETING);
  return conversationId;
}

export function appendTurn(conversationId: string, speaker: "AI" | "CUSTOMER", text: string) {
  const row = db
    .prepare(`SELECT COALESCE(MAX(turn_index), -1) + 1 as nextIndex FROM transcript_turns WHERE conversation_id = @cid`)
    .get({ "@cid": conversationId }) as { nextIndex: number };

  db.prepare(`
    INSERT INTO transcript_turns (conversation_id, turn_index, speaker, text) VALUES (@cid, @idx, @speaker, @text)
  `).run({ "@cid": conversationId, "@idx": row.nextIndex, "@speaker": speaker, "@text": text });
}

// Idempotent: Twilio can deliver the "completed" status callback after we've already hung up
// ourselves, so a second call leaves the first end_time/duration alone.
export function endConversation(conversationId: string): { durationSeconds: number } | null {
  const conversation = db
    .prepare(`SELECT start_time, status, duration_seconds FROM conversations WHERE id = @id`)
    .get({ "@id": conversationId }) as { start_time: string; status: string; duration_seconds: number | null } | undefined;
  if (!conversation) return null;
  if (conversation.status !== "IN_PROGRESS") return { durationSeconds: conversation.duration_seconds ?? 0 };

  const endTime = new Date();
  const durationSeconds = Math.round((endTime.getTime() - new Date(conversation.start_time).getTime()) / 1000);

  db.prepare(`
    UPDATE conversations SET status = 'COMPLETED', end_time = @endTime, duration_seconds = @duration WHERE id = @id
  `).run({ "@endTime": endTime.toISOString(), "@duration": durationSeconds, "@id": conversationId });

  return { durationSeconds };
}

export function conversationExists(conversationId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM conversations WHERE id = @id`).get({ "@id": conversationId }));
}
