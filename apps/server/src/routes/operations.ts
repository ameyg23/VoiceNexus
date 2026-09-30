// Employee-only operations APIs: tenant settings (VN-7/VN-9), the live-agent escalation queue (VN-5),
// and scheduled follow-ups — callbacks, technician visits, payment promises (VN-4/VN-8).

import { Router } from "express";
import { z } from "zod";
import { db } from "@voice-nexus/db";
import { requireEmployeeAuth } from "../lib/auth.js";
import { DEFAULT_SETTINGS, getSettings, settingsSchema, updateSettings, buildGreeting, toSpeech, routingCodeForIntent } from "../lib/settings.js";
import { describeAction, safeJson } from "../lib/actions.js";
import { sqliteUtcToIso } from "../lib/outcome.js";

export const settingsRouter = Router();
export const escalationsRouter = Router();
export const actionsRouter = Router();
settingsRouter.use(requireEmployeeAuth);
escalationsRouter.use(requireEmployeeAuth);
actionsRouter.use(requireEmployeeAuth);

// ---------- settings ----------

settingsRouter.get("/", (_req, res) => {
  const settings = getSettings();
  res.json({ settings, defaults: DEFAULT_SETTINGS, preview: previewOf(settings) });
});

// PUT /api/settings — partial update; every field is validated against the same schema the call
// engine reads, so a bad value can't reach a live call.
settingsRouter.put("/", (req, res) => {
  const parsed = settingsSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const settings = updateSettings(parsed.data);
  res.json({ settings, defaults: DEFAULT_SETTINGS, preview: previewOf(settings) });
});

function previewOf(s: ReturnType<typeof getSettings>) {
  const greeting = buildGreeting(s);
  return { greeting, greetingSpoken: toSpeech(greeting, s) };
}

// ---------- escalations (live-agent queue) ----------

interface EscalationRow {
  id: number;
  conversation_id: string;
  customer_id: string | null;
  customer_name: string | null;
  ani: string;
  ban_provided: string | null;
  verified: number;
  reason: string;
  intent: string | null;
  summary: string;
  attempted: string;
  routing_code: string | null;
  status: string;
  accepted_by_name: string | null;
  notes: string | null;
  created_at: string;
  accepted_at: string | null;
  resolved_at: string | null;
}

const ESCALATION_SELECT = `
  SELECT e.*, cu.name as customer_name, c.ani, c.ban_provided, emp.name as accepted_by_name
  FROM escalations e
  JOIN conversations c ON c.id = e.conversation_id
  LEFT JOIN customers cu ON cu.id = e.customer_id
  LEFT JOIN employees emp ON emp.id = e.accepted_by`;

// `settings` is passed in (not re-fetched per row) so mapping a list of escalations doesn't re-query
// tenant_settings once per row — see call sites below.
export function toEscalationView(r: EscalationRow, settings = getSettings()) {
  const expectedRoutingCode = routingCodeForIntent(settings, r.intent);
  return {
    id: r.id,
    conversationId: r.conversation_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    ani: r.ani,
    banProvided: r.ban_provided,
    verified: Boolean(r.verified),
    reason: r.reason,
    intent: r.intent,
    summary: r.summary,
    attempted: (() => {
      try {
        return JSON.parse(r.attempted) as string[];
      } catch {
        return [];
      }
    })(),
    routingCode: r.routing_code,
    // What the caller's topic *should* have routed to, per the current per-intent settings, next to
    // what was actually spoken (routingCode) — lets ops spot a misroute at a glance (user request).
    // A mismatch here means either a real routing bug, or the operator changed the routing codes
    // after this call happened — both are worth a human's eyes, so it's surfaced either way.
    expectedRoutingCode,
    routingMatch: r.routing_code === null || r.routing_code === expectedRoutingCode,
    status: r.status,
    acceptedByName: r.accepted_by_name,
    notes: r.notes,
    createdAt: sqliteUtcToIso(r.created_at),
    acceptedAt: sqliteUtcToIso(r.accepted_at),
    resolvedAt: sqliteUtcToIso(r.resolved_at),
  };
}

export function escalationForConversation(conversationId: string) {
  const row = db.prepare(`${ESCALATION_SELECT} WHERE e.conversation_id = @cid`).get({ "@cid": conversationId }) as EscalationRow | undefined;
  return row ? toEscalationView(row) : null;
}

const escalationQuery = z.object({ status: z.enum(["WAITING", "ACCEPTED", "RESOLVED", "OPEN"]).optional() });

// GET /api/escalations?status=OPEN|WAITING|ACCEPTED|RESOLVED — OPEN = waiting or accepted.
escalationsRouter.get("/", (req, res) => {
  const parsed = escalationQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { status } = parsed.data;
  const where = status === "OPEN" ? `WHERE e.status IN ('WAITING', 'ACCEPTED')` : status ? `WHERE e.status = @status` : "";
  const rows = db.prepare(`${ESCALATION_SELECT} ${where} ORDER BY e.id DESC LIMIT 500`).all(status && status !== "OPEN" ? { "@status": status } : {}) as unknown as EscalationRow[];
  const settings = getSettings();
  res.json({ escalations: rows.map((r) => toEscalationView(r, settings)) });
});

// POST /api/escalations/:id/accept — an agent picks up the handoff.
escalationsRouter.post("/:id/accept", (req, res) => {
  const result = db
    .prepare(`UPDATE escalations SET status = 'ACCEPTED', accepted_by = @emp, accepted_at = datetime('now') WHERE id = @id AND status = 'WAITING'`)
    .run({ "@emp": req.employee!.employeeId, "@id": Number(req.params.id) });
  if (result.changes === 0) return res.status(409).json({ error: "escalation not found or already taken" });
  const row = db.prepare(`${ESCALATION_SELECT} WHERE e.id = @id`).get({ "@id": Number(req.params.id) }) as unknown as EscalationRow;
  res.json({ escalation: toEscalationView(row) });
});

const resolveSchema = z.object({ notes: z.string().trim().max(2000).optional() });

// POST /api/escalations/:id/resolve — closes the handoff with the agent's notes.
escalationsRouter.post("/:id/resolve", (req, res) => {
  const parsed = resolveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = db
    .prepare(
      `UPDATE escalations SET status = 'RESOLVED', resolved_at = datetime('now'), notes = @notes,
         accepted_by = COALESCE(accepted_by, @emp), accepted_at = COALESCE(accepted_at, datetime('now'))
       WHERE id = @id AND status <> 'RESOLVED'`
    )
    .run({ "@notes": parsed.data.notes ?? null, "@emp": req.employee!.employeeId, "@id": Number(req.params.id) });
  if (result.changes === 0) return res.status(409).json({ error: "escalation not found or already resolved" });
  const row = db.prepare(`${ESCALATION_SELECT} WHERE e.id = @id`).get({ "@id": Number(req.params.id) }) as unknown as EscalationRow;
  res.json({ escalation: toEscalationView(row) });
});

// ---------- call actions (callbacks, tech visits, payment promises, transactions) ----------

interface ActionRow {
  id: number;
  conversation_id: string;
  customer_id: string | null;
  customer_name: string | null;
  type: string;
  status: string;
  details: string;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export function toActionView(r: ActionRow) {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    type: r.type,
    status: r.status,
    details: safeJson(r.details),
    scheduledFor: r.scheduled_for,
    description: describeAction(r as never),
    createdAt: sqliteUtcToIso(r.created_at),
    updatedAt: sqliteUtcToIso(r.updated_at),
  };
}

const ACTION_SELECT = `SELECT a.*, cu.name as customer_name FROM call_actions a LEFT JOIN customers cu ON cu.id = a.customer_id`;

export function actionViewsWhere(where: string, params: Record<string, string | number>) {
  const rows = db.prepare(`${ACTION_SELECT} ${where ? `WHERE ${where}` : ""} ORDER BY a.id DESC LIMIT 500`).all(params) as unknown as ActionRow[];
  return rows.map(toActionView);
}

const actionQuery = z.object({
  type: z.enum(["PAYMENT", "PLAN_CHANGE", "PAYMENT_PROMISE", "TECH_VISIT", "CALLBACK"]).optional(),
  status: z.enum(["COMPLETED", "SCHEDULED", "DONE", "CANCELLED"]).optional(),
});

actionsRouter.get("/", (req, res) => {
  const parsed = actionQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (parsed.data.type) {
    clauses.push(`a.type = @type`);
    params["@type"] = parsed.data.type;
  }
  if (parsed.data.status) {
    clauses.push(`a.status = @status`);
    params["@status"] = parsed.data.status;
  }
  res.json({ actions: actionViewsWhere(clauses.join(" AND "), params) });
});

const actionStatusSchema = z.object({ status: z.enum(["DONE", "CANCELLED"]) });

// POST /api/actions/:id/status — ops marks a scheduled follow-up done or cancelled.
actionsRouter.post("/:id/status", (req, res) => {
  const parsed = actionStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = db
    .prepare(`UPDATE call_actions SET status = @status, updated_at = datetime('now') WHERE id = @id AND status = 'SCHEDULED'`)
    .run({ "@status": parsed.data.status, "@id": Number(req.params.id) });
  if (result.changes === 0) return res.status(409).json({ error: "action not found or not scheduled" });
  const [action] = actionViewsWhere(`a.id = @id`, { "@id": Number(req.params.id) });
  res.json({ action });
});
