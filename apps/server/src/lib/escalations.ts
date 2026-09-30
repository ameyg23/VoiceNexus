// Structured escalation handoff (PRD VN-5, "Clean transfer"): when the assistant hands a caller to a
// live agent, it records who they are, whether identity was verified (and how), what they wanted, what
// was already attempted, and what they last said — so the agent picks up with full context. The
// summary is assembled from recorded state only (never AI-written), so it can't contain a made-up fact.

import { db } from "@voice-nexus/db";
import type { EscalationReason, Intent } from "@voice-nexus/shared";
import { actionsForConversation, describeAction } from "./actions.js";

const REASON_TEXT: Record<EscalationReason, string> = {
  PIN_LOCKOUT: "Caller couldn't be verified: 3 incorrect PINs",
  OTP_FAILED: "Caller couldn't be verified: one-time code attempts exhausted",
  VERIFICATION_FAILED: "Caller couldn't be verified",
  CALLER_REQUESTED: "Caller asked for a live agent",
  UNRESOLVED_REQUEST: "Assistant couldn't resolve the request in-flow",
  BAN_LOOKUP_FAILED: "Caller couldn't be identified: 3 account numbers not on file",
  NEW_CUSTOMER_ENROLLMENT: "New (not yet a customer) caller wants to sign up",
};

interface ConversationFacts {
  ani: string;
  ban_provided: string | null;
  customer_id: string | null;
  auth_status: string;
  auth_method: string | null;
  detected_intent: string | null;
  customer_name: string | null;
  session_customer_id: string | null;
  pin_attempts: number | null;
}

export function createEscalation(conversationId: string, reason: EscalationReason, routingCode: string | null = null): void {
  const existing = db.prepare(`SELECT id FROM escalations WHERE conversation_id = @cid`).get({ "@cid": conversationId });
  if (existing) return;

  const c = db
    .prepare(
      `SELECT c.ani, c.ban_provided, c.customer_id, c.auth_status, c.auth_method, c.detected_intent,
              cu.name as customer_name, s.customer_id as session_customer_id, s.pin_attempts
       FROM conversations c
       LEFT JOIN auth_sessions s ON s.conversation_id = c.id
       LEFT JOIN customers cu ON cu.id = COALESCE(c.customer_id, s.customer_id)
       WHERE c.id = @cid`
    )
    .get({ "@cid": conversationId }) as ConversationFacts | undefined;
  if (!c) return;

  const verified = c.auth_status === "SUCCESS";
  const customerId = c.customer_id ?? c.session_customer_id;
  const attempted: string[] = [];
  if (c.ban_provided) attempted.push(`Caller gave account number ${c.ban_provided}`);
  if (verified) attempted.push(`Identity verified by ${c.auth_method === "PIN" ? "PIN" : c.auth_method === "SMS_OTP" ? "SMS one-time code" : "email one-time code"}`);
  else if (c.pin_attempts) attempted.push(`${c.pin_attempts} incorrect PIN attempt(s)`);
  const otps = db.prepare(`SELECT method, status FROM otps WHERE conversation_id = @cid ORDER BY id`).all({ "@cid": conversationId }) as { method: string; status: string }[];
  if (otps.length) attempted.push(`Sent ${otps.length} one-time code(s) by ${otps[0].method.toLowerCase()}, last ${otps[otps.length - 1].status.toLowerCase()}`);
  for (const a of actionsForConversation(conversationId)) attempted.push(describeAction(a));

  const lastWords = db
    .prepare(`SELECT text FROM transcript_turns WHERE conversation_id = @cid AND speaker = 'CUSTOMER' ORDER BY turn_index DESC LIMIT 2`)
    .all({ "@cid": conversationId }) as { text: string }[];

  const who = c.customer_name ? `${c.customer_name}${c.ban_provided ? ` (${c.ban_provided})` : ""}` : `Unidentified caller from ${c.ani}`;
  const summary = [
    `${REASON_TEXT[reason]}.`,
    `Caller: ${who}. ${verified ? "Identity VERIFIED" : "Identity NOT verified; re-verify before sharing account details"}.`,
    `Wants: ${intentText(c.detected_intent as Intent | null)}.`,
    lastWords.length ? `Last said: "${lastWords.reverse().map((w) => w.text).join(" / ")}".` : null,
  ]
    .filter(Boolean)
    .join(" ");

  db.prepare(
    `INSERT INTO escalations (conversation_id, customer_id, verified, reason, intent, summary, attempted, routing_code)
     VALUES (@cid, @custId, @verified, @reason, @intent, @summary, @attempted, @routingCode)`
  ).run({
    "@cid": conversationId,
    "@custId": customerId,
    "@verified": verified ? 1 : 0,
    "@reason": reason,
    "@intent": c.detected_intent,
    "@summary": summary,
    "@attempted": JSON.stringify(attempted),
    "@routingCode": routingCode,
  });
}

function intentText(intent: Intent | null): string {
  const map: Partial<Record<Intent, string>> = {
    CHECK_BALANCE: "their account balance",
    MAKE_PAYMENT: "to make a payment",
    PAYMENT_HISTORY: "their payment history",
    BILLING_DUE_DATE: "their bill due date",
    PAYMENT_PROMISE: "a payment arrangement",
    PLAN_INFO: "information about their plan",
    PLAN_CHANGE: "to change their plan",
    AUTOPAY_STATUS: "their autopay status",
    OUTAGE_CHECK: "to check for an outage",
    TECH_TRIAGE: "help with a technical problem",
    SCHEDULE_TECH: "a technician visit",
    SCHEDULE_CALLBACK: "a callback",
    AGENT_REQUEST: "to speak with an agent (no specific request captured)",
  };
  return (intent && map[intent]) || "not determined";
}
