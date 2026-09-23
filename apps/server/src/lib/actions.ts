// Call actions: every transaction the assistant completes (payment, plan change) and every follow-up
// it schedules (payment promise, technician visit, callback). Feeds the call detail "actions taken",
// the escalation handoff's "already attempted", the Callbacks queue, and reporting.

import { db } from "@voice-nexus/db";
import type { CallActionStatus, CallActionType } from "@voice-nexus/shared";

export interface CallActionRow {
  id: number;
  conversation_id: string;
  customer_id: string | null;
  type: CallActionType;
  status: CallActionStatus;
  details: string;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export function recordAction(
  conversationId: string,
  customerId: string | null,
  type: CallActionType,
  status: CallActionStatus,
  details: Record<string, unknown>,
  scheduledFor?: string
): number {
  const result = db
    .prepare(
      `INSERT INTO call_actions (conversation_id, customer_id, type, status, details, scheduled_for)
       VALUES (@cid, @custId, @type, @status, @details, @when)`
    )
    .run({
      "@cid": conversationId,
      "@custId": customerId,
      "@type": type,
      "@status": status,
      "@details": JSON.stringify(details),
      "@when": scheduledFor ?? null,
    });
  return Number(result.lastInsertRowid);
}

export function actionsForConversation(conversationId: string): CallActionRow[] {
  return db.prepare(`SELECT * FROM call_actions WHERE conversation_id = @cid ORDER BY id`).all({ "@cid": conversationId }) as unknown as CallActionRow[];
}

// One-line plain-language description, used in handoff summaries and the dashboard.
export function describeAction(a: Pick<CallActionRow, "type" | "details" | "scheduled_for" | "status">): string {
  const d = safeJson(a.details);
  switch (a.type) {
    case "PAYMENT":
      return `Took a payment of $${Number(d.amount ?? 0).toFixed(2)}`;
    case "PLAN_CHANGE":
      return `Changed plan from ${d.fromPlan ?? "?"} to ${d.toPlan ?? "?"}`;
    case "PAYMENT_PROMISE":
      return `Logged a promise to pay $${Number(d.amount ?? 0).toFixed(2)} by ${a.scheduled_for ?? "?"}`;
    case "TECH_VISIT":
      return `Scheduled a technician visit for ${a.scheduled_for ?? "?"} (${d.windowLabel ?? d.window ?? "any time"})`;
    case "CALLBACK":
      return `Scheduled a callback to ${d.phone ?? "the caller"} for ${a.scheduled_for ?? "?"} (${d.windowLabel ?? d.window ?? "any time"})`;
  }
}

export function safeJson(text: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(text ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
