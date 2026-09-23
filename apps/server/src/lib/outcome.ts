// One definition of a call's outcome, shared by every dashboard query so the Calls list, Reports and
// the overview tiles never disagree. Derived from existing columns rather than stored, so it's always
// consistent with auth_status/status:
//   ESCALATED   — handed to a live agent (verification failed, caller asked, or unresolvable request)
//   CALLBACK    — a callback was booked instead (a human follows up; not contained, not transferred)
//   RESOLVED    — caller was verified and served by the assistant
//   IN_PROGRESS — still live
//   ABANDONED   — ended (or went stale) before verification finished
// A call left IN_PROGRESS for over an hour is treated as ended — demo calls closed without pressing
// End Call, or a phone call whose status callback never arrived.

import type { CallOutcome } from "@voice-nexus/shared";

const ESCALATED = `(c.auth_status = 'FAILED' OR EXISTS (SELECT 1 FROM escalations e WHERE e.conversation_id = c.id))`;
const CALLBACK = `EXISTS (SELECT 1 FROM call_actions a WHERE a.conversation_id = c.id AND a.type = 'CALLBACK' AND a.status <> 'CANCELLED')`;
const STALE = `(c.status = 'IN_PROGRESS' AND julianday(c.start_time) < julianday('now', '-1 hour'))`;

export const OUTCOME_SQL = `
  CASE
    WHEN ${ESCALATED} THEN 'ESCALATED'
    WHEN ${CALLBACK} THEN 'CALLBACK'
    WHEN c.auth_status = 'SUCCESS' AND (c.status <> 'IN_PROGRESS' OR ${STALE}) THEN 'RESOLVED'
    WHEN c.status = 'IN_PROGRESS' AND NOT ${STALE} THEN 'IN_PROGRESS'
    ELSE 'ABANDONED'
  END`;

// Why an ESCALATED call was handed off: the recorded handoff's reason, or — for calls that failed
// verification before handoffs were recorded — derived from the auth trail.
export const ESCALATION_REASON_SQL = `
  CASE
    WHEN EXISTS (SELECT 1 FROM escalations e WHERE e.conversation_id = c.id) THEN (SELECT e.reason FROM escalations e WHERE e.conversation_id = c.id)
    WHEN c.auth_status <> 'FAILED' THEN NULL
    WHEN (SELECT pin_attempts FROM auth_sessions s WHERE s.conversation_id = c.id) >= 3 THEN 'PIN_LOCKOUT'
    WHEN EXISTS (SELECT 1 FROM otps o WHERE o.conversation_id = c.id AND o.status = 'FAILED') THEN 'OTP_FAILED'
    ELSE 'VERIFICATION_FAILED'
  END`;

export const CALL_OUTCOMES: CallOutcome[] = ["RESOLVED", "ESCALATED", "CALLBACK", "ABANDONED", "IN_PROGRESS"];

// transcript_turns.timestamp is SQLite's datetime('now') — UTC but with no zone marker. Normalize to
// ISO-8601 so browsers don't parse it as local time.
export function sqliteUtcToIso(value: string | null): string | null {
  if (!value) return null;
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}
