import { Router } from "express";
import { z } from "zod";
import { db } from "@voice-nexus/db";
import { requireEmployeeAuth } from "../lib/auth.js";
import { OUTCOME_SQL, ESCALATION_REASON_SQL, CALL_OUTCOMES, sqliteUtcToIso } from "../lib/outcome.js";
import { resolveRecording } from "../lib/recordings.js";
import { actionViewsWhere, escalationForConversation } from "./operations.js";

// Employee-only conversation views for the ops dashboard (ARCHITECTURE.md §10/§15).
export const conversationsRouter = Router();
conversationsRouter.use(requireEmployeeAuth);

interface ConversationListRow {
  id: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  ani: string;
  banProvided: string | null;
  customerId: string | null;
  customerName: string | null;
  authStatus: string;
  authMethod: string | null;
  detectedIntent: string | null;
  status: string;
  outcome: string;
  escalationReason: string | null;
  channel: string;
  hasAudio: number;
  turnCount: number;
  csatScore: number | null;
}

const LIST_COLUMNS = `
  c.id, c.start_time as startTime, c.end_time as endTime, c.duration_seconds as durationSeconds,
  c.ani, c.ban_provided as banProvided, c.customer_id as customerId, cu.name as customerName,
  c.auth_status as authStatus, c.auth_method as authMethod, c.detected_intent as detectedIntent,
  c.status, ${OUTCOME_SQL} as outcome, ${ESCALATION_REASON_SQL} as escalationReason, c.channel,
  (c.audio_path IS NOT NULL) as hasAudio,
  (SELECT COUNT(*) FROM transcript_turns t WHERE t.conversation_id = c.id) as turnCount,
  c.csat_score as csatScore`;

export function mapListRow(row: ConversationListRow) {
  return { ...row, hasAudio: Boolean(row.hasAudio) };
}

// Also used by the customer detail and dashboard overview, so they list calls the same way.
export function listConversations(where: string, params: Record<string, string | number>, limit: number) {
  const rows = db
    .prepare(
      `SELECT ${LIST_COLUMNS}
       FROM conversations c LEFT JOIN customers cu ON cu.id = c.customer_id
       ${where ? `WHERE ${where}` : ""}
       ORDER BY c.start_time DESC
       LIMIT ${limit}`
    )
    .all(params) as unknown as ConversationListRow[];
  return rows.map(mapListRow);
}

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  outcome: z.enum(CALL_OUTCOMES as [string, ...string[]]).optional(),
  intent: z.string().max(40).optional(),
  channel: z.enum(["DEMO", "PHONE"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// GET /api/conversations?q=&outcome=&intent=&channel=&limit= — search matches call ID, caller
// number, BAN, customer name, intent, or any transcript line (ARCHITECTURE.md §14 LIKE search).
conversationsRouter.get("/", (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { q, outcome, intent, channel, limit } = parsed.data;

  const clauses: string[] = [];
  const params: Record<string, string | number> = {};

  if (q) {
    params["@q"] = `%${q}%`;
    clauses.push(`(
      c.id LIKE @q OR c.ani LIKE @q OR c.ban_provided LIKE @q OR cu.name LIKE @q OR c.detected_intent LIKE @q
      OR EXISTS (SELECT 1 FROM transcript_turns t WHERE t.conversation_id = c.id AND t.text LIKE @q)
    )`);
  }
  if (outcome) {
    params["@outcome"] = outcome;
    clauses.push(`${OUTCOME_SQL} = @outcome`);
  }
  if (intent) {
    params["@intent"] = intent;
    clauses.push(`c.detected_intent = @intent`);
  }
  if (channel) {
    params["@channel"] = channel;
    clauses.push(`c.channel = @channel`);
  }

  res.json({ conversations: listConversations(clauses.join(" AND "), params, limit) });
});

// GET /api/conversations/:id — detail + full transcript + auth trail.
conversationsRouter.get("/:id", (req, res) => {
  const [conversation] = listConversations(`c.id = @id`, { "@id": req.params.id }, 1);
  if (!conversation) return res.status(404).json({ error: "conversation not found" });

  const turns = (
    db
      .prepare(
        `SELECT turn_index as turnIndex, speaker, text, timestamp, latency_ms as latencyMs FROM transcript_turns
         WHERE conversation_id = @id ORDER BY turn_index`
      )
      .all({ "@id": req.params.id }) as { turnIndex: number; speaker: string; text: string; timestamp: string; latencyMs: number | null }[]
  ).map((t) => ({ ...t, timestamp: sqliteUtcToIso(t.timestamp) }));

  const session = db
    .prepare(`SELECT stage, pin_attempts as pinAttempts, authenticated_at as authenticatedAt FROM auth_sessions WHERE conversation_id = @id`)
    .get({ "@id": req.params.id }) as { stage: string; pinAttempts: number; authenticatedAt: string | null } | undefined;

  // OTP audit trail — status/method/destination only; the code hash never leaves the server.
  const otps = (
    db
      .prepare(
        `SELECT method, destination_masked as destinationMasked, status, attempts, created_at as createdAt
         FROM otps WHERE conversation_id = @id ORDER BY id`
      )
      .all({ "@id": req.params.id }) as { method: string; destinationMasked: string; status: string; attempts: number; createdAt: string }[]
  ).map((o) => ({ ...o, createdAt: sqliteUtcToIso(o.createdAt) }));

  res.json({
    conversation,
    turns,
    authSession: session ?? null,
    otps,
    actions: actionViewsWhere(`a.conversation_id = @id`, { "@id": req.params.id }).reverse(),
    escalation: escalationForConversation(req.params.id),
  });
});

// GET /api/conversations/:id/audio — streams the recording (webm for demo calls, mp3 for phone).
conversationsRouter.get("/:id/audio", (req, res) => {
  const row = db.prepare(`SELECT audio_path FROM conversations WHERE id = @id`).get({ "@id": req.params.id }) as
    | { audio_path: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "conversation not found" });

  const file = row.audio_path ? resolveRecording(row.audio_path) : null;
  if (!file) return res.status(404).json({ error: "no recording for this conversation" });

  res.sendFile(file);
});
