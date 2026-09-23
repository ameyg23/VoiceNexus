// One definition of a call's outcome, shared by every dashboard query so the Calls list, Reports and
// the overview tiles never disagree. Derived from existing columns rather than stored, so it's always
// consistent with auth_status/status:
//   ESCALATED   — verification failed (PIN lockout / OTP failure); the AI hands off to an agent
//   RESOLVED    — caller was verified and served
//   IN_PROGRESS — still live
//   ABANDONED   — ended (or went stale) before verification finished
// A call left IN_PROGRESS for over an hour is treated as ended — demo calls closed without pressing
// End Call, or a phone call whose status callback never arrived.

import type { CallOutcome } from "@voice-nexus/shared";

const STALE = `(c.status = 'IN_PROGRESS' AND julianday(c.start_time) < julianday('now', '-1 hour'))`;

export const OUTCOME_SQL = `
  CASE
    WHEN c.auth_status = 'FAILED' THEN 'ESCALATED'
    WHEN c.auth_status = 'SUCCESS' AND (c.status <> 'IN_PROGRESS' OR ${STALE}) THEN 'RESOLVED'
    WHEN c.status = 'IN_PROGRESS' AND NOT ${STALE} THEN 'IN_PROGRESS'
    ELSE 'ABANDONED'
  END`;

// Why an ESCALATED call was handed off — the only escalation path today is failed verification
// (authStateMachine.ts markFailed), via either the PIN lockout or OTP attempts running out.
export const ESCALATION_REASON_SQL = `
  CASE
    WHEN c.auth_status <> 'FAILED' THEN NULL
    WHEN (SELECT pin_attempts FROM auth_sessions s WHERE s.conversation_id = c.id) >= 3 THEN 'PIN_LOCKOUT'
    WHEN EXISTS (SELECT 1 FROM otps o WHERE o.conversation_id = c.id AND o.status = 'FAILED') THEN 'OTP_FAILED'
    ELSE 'VERIFICATION_FAILED'
  END`;

export const CALL_OUTCOMES: CallOutcome[] = ["RESOLVED", "ESCALATED", "ABANDONED", "IN_PROGRESS"];

// transcript_turns.timestamp is SQLite's datetime('now') — UTC but with no zone marker. Normalize to
// ISO-8601 so browsers don't parse it as local time.
export function sqliteUtcToIso(value: string | null): string | null {
  if (!value) return null;
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}
