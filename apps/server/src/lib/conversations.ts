// Conversation lifecycle shared by both audio channels — the browser demo (routes/calls.ts) and the
// Twilio care line (routes/twilio.ts). Only the audio I/O differs between them (ARCHITECTURE.md §19);
// creating the conversation, recording transcript turns, and finalizing it are identical.

import { db } from "@voice-nexus/db";
import type { Channel } from "@voice-nexus/shared";
import { nextConversationId } from "./ids.js";
import { buildGreeting, getSettings, LANGUAGE_NAMES } from "./settings.js";
import { translateAI } from "./aiEngine.js";

// The operator's configured greeting (VN-9) with its AI/recording disclosures, in the tenant language.
export async function greetingText(): Promise<string> {
  const settings = getSettings();
  const greeting = buildGreeting(settings);
  if (settings.language === "en-US") return greeting;
  return (await translateAI(greeting, LANGUAGE_NAMES[settings.language])) ?? greeting;
}

// ANI is display-only and never grants auth (ARCHITECTURE.md §18) — the auth session always
// starts at AWAITING_INTENT, exactly as for an unknown caller.
export function startConversation(ani: string, channel: Channel, greeting: string, twilioCallSid?: string): string {
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

  appendTurn(conversationId, "AI", greeting);
  return conversationId;
}

// latencyMs: server time to produce an AI reply (NFR "latency to first response"); null for caller turns.
export function appendTurn(conversationId: string, speaker: "AI" | "CUSTOMER", text: string, latencyMs?: number) {
  const row = db
    .prepare(`SELECT COALESCE(MAX(turn_index), -1) + 1 as nextIndex FROM transcript_turns WHERE conversation_id = @cid`)
    .get({ "@cid": conversationId }) as { nextIndex: number };

  db.prepare(`
    INSERT INTO transcript_turns (conversation_id, turn_index, speaker, text, latency_ms) VALUES (@cid, @idx, @speaker, @text, @latency)
  `).run({ "@cid": conversationId, "@idx": row.nextIndex, "@speaker": speaker, "@text": text, "@latency": latencyMs ?? null });
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

export function conversationStatus(conversationId: string): string | null {
  const row = db.prepare(`SELECT status FROM conversations WHERE id = @id`).get({ "@id": conversationId }) as { status: string } | undefined;
  return row?.status ?? null;
}

export function conversationExists(conversationId: string): boolean {
  return conversationStatus(conversationId) !== null;
}
