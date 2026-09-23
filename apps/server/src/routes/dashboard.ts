import { Router } from "express";
import { z } from "zod";
import { db } from "@voice-nexus/db";
import { requireEmployeeAuth } from "../lib/auth.js";
import { OUTCOME_SQL, ESCALATION_REASON_SQL } from "../lib/outcome.js";
import { GEMINI_MODEL } from "../lib/aiEngine.js";
import { INTENT_CATALOG } from "../lib/intentCatalog.js";
import { listConversations } from "./conversations.js";

// Employee-only aggregate views for the ops dashboard (ARCHITECTURE.md §10/§15). Every count goes
// through OUTCOME_SQL so the overview, Reports and Calls list agree.
export const dashboardRouter = Router();
dashboardRouter.use(requireEmployeeAuth);

const count = (outcome: string) => `SUM(CASE WHEN ${OUTCOME_SQL} = '${outcome}' THEN 1 ELSE 0 END)`;

// GET /api/dashboard/summary — overview tiles, distributions, and recent calls.
dashboardRouter.get("/summary", (_req, res) => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) as totalCalls,
         ${count("RESOLVED")} as resolved, ${count("ESCALATED")} as escalated,
         ${count("ABANDONED")} as abandoned, ${count("IN_PROGRESS")} as inProgress,
         AVG(c.duration_seconds) as avgHandleSeconds
       FROM conversations c`
    )
    .get() as Record<string, number | null>;

  const authMethods = db
    .prepare(`SELECT auth_method as method, COUNT(*) as count FROM conversations WHERE auth_status = 'SUCCESS' GROUP BY auth_method`)
    .all() as { method: string; count: number }[];

  const intents = db
    .prepare(
      `SELECT detected_intent as intent, COUNT(*) as count FROM conversations
       WHERE detected_intent IS NOT NULL GROUP BY detected_intent ORDER BY count DESC`
    )
    .all() as { intent: string; count: number }[];

  res.json({
    totalCalls: totals.totalCalls ?? 0,
    resolved: totals.resolved ?? 0,
    escalated: totals.escalated ?? 0,
    abandoned: totals.abandoned ?? 0,
    inProgress: totals.inProgress ?? 0,
    avgHandleSeconds: totals.avgHandleSeconds === null ? null : Math.round(totals.avgHandleSeconds),
    authMethods,
    intents,
    recentCalls: listConversations("", {}, 6),
  });
});

const reportsQuery = z.object({
  // Browser's Date#getTimezoneOffset() (minutes, UTC minus local — IST is -330), so day/hour buckets
  // match the viewer's clock instead of UTC.
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
  days: z.coerce.number().int().min(1).max(90).default(14),
});

// GET /api/dashboard/reports?tzOffset=&days= — trends and breakdowns for the Reports page.
dashboardRouter.get("/reports", (req, res) => {
  const parsed = reportsQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tzOffset, days } = parsed.data;
  const local = `'${-tzOffset} minutes'`;

  const byDayRows = db
    .prepare(
      `SELECT date(c.start_time, ${local}) as day, COUNT(*) as total, ${count("RESOLVED")} as resolved, ${count("ESCALATED")} as escalated
       FROM conversations c
       WHERE date(c.start_time, ${local}) >= date('now', ${local}, '-${days - 1} days')
       GROUP BY day`
    )
    .all() as { day: string; total: number; resolved: number; escalated: number }[];

  // Fill empty days so the chart has a continuous axis.
  const byDay = new Map(byDayRows.map((r) => [r.day, r]));
  const callsByDay = [];
  const today = new Date(Date.now() - tzOffset * 60_000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    callsByDay.push(byDay.get(d) ?? { day: d, total: 0, resolved: 0, escalated: 0 });
  }

  const hourRows = db
    .prepare(`SELECT CAST(strftime('%H', c.start_time, ${local}) AS INTEGER) as hour, COUNT(*) as total FROM conversations c GROUP BY hour`)
    .all() as { hour: number; total: number }[];
  const callsByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, total: hourRows.find((r) => r.hour === hour)?.total ?? 0 }));

  const intentPerformance = db
    .prepare(
      `SELECT COALESCE(c.detected_intent, 'UNKNOWN') as intent, COUNT(*) as total,
         ${count("RESOLVED")} as resolved, ${count("ESCALATED")} as escalated, ${count("ABANDONED")} as abandoned
       FROM conversations c GROUP BY intent ORDER BY total DESC`
    )
    .all();

  const handleTime = db
    .prepare(
      `SELECT ${OUTCOME_SQL} as outcome, COUNT(c.duration_seconds) as calls, AVG(c.duration_seconds) as avgSeconds
       FROM conversations c GROUP BY outcome`
    )
    .all() as { outcome: string; calls: number; avgSeconds: number | null }[];
  const overallAht = db.prepare(`SELECT COUNT(duration_seconds) as calls, AVG(duration_seconds) as avgSeconds FROM conversations`).get() as {
    calls: number;
    avgSeconds: number | null;
  };

  // Verification funnel: how far callers get through the Auth State Machine.
  const funnel = db
    .prepare(
      `SELECT COUNT(*) as calls,
         SUM(CASE WHEN c.ban_provided IS NOT NULL THEN 1 ELSE 0 END) as banProvided,
         SUM(CASE WHEN s.customer_id IS NOT NULL THEN 1 ELSE 0 END) as accountFound,
         SUM(CASE WHEN c.auth_status = 'SUCCESS' THEN 1 ELSE 0 END) as verified
       FROM conversations c LEFT JOIN auth_sessions s ON s.conversation_id = c.id`
    )
    .get();

  const authMethods = db
    .prepare(
      `SELECT cu.mfa_method as configured, COUNT(*) as attempted, SUM(CASE WHEN c.auth_status = 'SUCCESS' THEN 1 ELSE 0 END) as verified,
         SUM(CASE WHEN c.auth_status = 'FAILED' THEN 1 ELSE 0 END) as failed
       FROM conversations c JOIN auth_sessions s ON s.conversation_id = c.id JOIN customers cu ON cu.id = s.customer_id
       GROUP BY cu.mfa_method`
    )
    .all();

  const escalationReasons = db
    .prepare(
      `SELECT ${ESCALATION_REASON_SQL} as reason, COUNT(*) as count FROM conversations c
       WHERE c.auth_status = 'FAILED' GROUP BY reason ORDER BY count DESC`
    )
    .all();

  const channels = db.prepare(`SELECT channel, COUNT(*) as count FROM conversations GROUP BY channel`).all();

  res.json({
    callsByDay,
    callsByHour,
    intentPerformance,
    handleTime: {
      overall: { calls: overallAht.calls, avgSeconds: roundOrNull(overallAht.avgSeconds) },
      byOutcome: handleTime.map((h) => ({ ...h, avgSeconds: roundOrNull(h.avgSeconds) })),
    },
    funnel,
    authMethods,
    escalationReasons,
    channels,
  });
});

// GET /api/dashboard/intents — the fixed intent catalog with live call counts.
dashboardRouter.get("/intents", (_req, res) => {
  const counts = db
    .prepare(
      `SELECT c.detected_intent as intent, COUNT(*) as total, ${count("RESOLVED")} as resolved, ${count("ESCALATED")} as escalated
       FROM conversations c WHERE c.detected_intent IS NOT NULL GROUP BY c.detected_intent`
    )
    .all() as { intent: string; total: number; resolved: number; escalated: number }[];

  res.json({
    intents: INTENT_CATALOG.map((info) => {
      const c = counts.find((r) => r.intent === info.intent);
      return { ...info, total: c?.total ?? 0, resolved: c?.resolved ?? 0, escalated: c?.escalated ?? 0 };
    }),
  });
});

// GET /api/dashboard/integrations — which external services are configured. Booleans and
// non-secret identifiers only; no key or token value ever leaves the server.
dashboardRouter.get("/integrations", (_req, res) => {
  const env = process.env;
  const set = (name: string) => Boolean(env[name]);
  res.json({
    gemini: { configured: set("GEMINI_API_KEY"), model: GEMINI_MODEL },
    resend: { configured: set("RESEND_API_KEY") && set("RESEND_FROM_EMAIL"), fromEmail: env.RESEND_FROM_EMAIL ?? null },
    twilio: {
      configured: set("TWILIO_ACCOUNT_SID") && set("TWILIO_AUTH_TOKEN"),
      careLineNumber: env.TWILIO_CARE_LINE_NUMBER ?? null,
      publicBaseUrl: env.PUBLIC_BASE_URL ?? null,
      voiceSdkConfigured: set("TWILIO_API_KEY_SID") && set("TWILIO_API_KEY_SECRET") && set("TWILIO_TWIML_APP_SID"),
    },
    demoMode: env.DEMO_MODE === "true",
  });
});

function roundOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n);
}
