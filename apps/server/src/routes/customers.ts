import { Router } from "express";
import { db } from "@voice-nexus/db";
import { requireEmployeeAuth } from "../lib/auth.js";
import { OUTCOME_SQL } from "../lib/outcome.js";
import type { CustomerRow } from "../lib/businessLogic.js";
import { listConversations } from "./conversations.js";
import { actionViewsWhere } from "./operations.js";

// Employee-only customer views (ARCHITECTURE.md §10/§15). PIN and portal-password hashes are never
// selected into a response.
export const customersRouter = Router();
customersRouter.use(requireEmployeeAuth);

type CustomerWithPhone = CustomerRow & { phone_number: string; created_at: string };

function toEmployeeView(row: CustomerWithPhone) {
  return {
    id: row.id,
    name: row.name,
    phoneNumber: row.phone_number,
    ban: row.ban,
    email: row.email,
    mfaMethod: row.mfa_method,
    mfaPhoneNumber: row.mfa_phone_number,
    planName: row.plan_name,
    accountStatus: row.account_status,
    currentBalance: row.current_balance,
    pastDueAmount: row.past_due_amount,
    lastPaymentAmount: row.last_payment_amount,
    lastPaymentDate: row.last_payment_date,
    nextBillingDueDate: row.next_billing_due_date,
    autopayEnabled: Boolean(row.autopay_enabled),
    discountPercent: row.discount_percent,
    hasPortalAccount: row.portal_password_hash !== null,
    serviceZip: row.service_zip,
    createdAt: row.created_at,
  };
}

// GET /api/customers — every customer with call counts.
customersRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT cu.*,
         (SELECT COUNT(*) FROM conversations c WHERE c.customer_id = cu.id) as callCount,
         (SELECT MAX(c.start_time) FROM conversations c WHERE c.customer_id = cu.id) as lastCallAt
       FROM customers cu ORDER BY cu.id`
    )
    .all() as unknown as (CustomerWithPhone & { callCount: number; lastCallAt: string | null })[];

  res.json({
    customers: rows.map((r) => ({ ...toEmployeeView(r), callCount: r.callCount, lastCallAt: r.lastCallAt })),
  });
});

// GET /api/customers/:id — account detail + every call linked to it. A call only links to a customer
// once their BAN resolved, so calls that never got that far can't appear here.
customersRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM customers WHERE id = @id`).get({ "@id": req.params.id }) as CustomerWithPhone | undefined;
  if (!row) return res.status(404).json({ error: "customer not found" });

  const conversations = listConversations(`c.customer_id = @id`, { "@id": row.id }, 200);
  const stats = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN ${OUTCOME_SQL} = 'RESOLVED' THEN 1 ELSE 0 END) as resolved,
              SUM(CASE WHEN ${OUTCOME_SQL} = 'ESCALATED' THEN 1 ELSE 0 END) as escalated
       FROM conversations c WHERE c.customer_id = @id`
    )
    .get({ "@id": row.id }) as { total: number; resolved: number | null; escalated: number | null };

  res.json({
    customer: toEmployeeView(row),
    conversations,
    actions: actionViewsWhere(`a.customer_id = @id`, { "@id": row.id }),
    stats: { total: stats.total, resolved: stats.resolved ?? 0, escalated: stats.escalated ?? 0 },
  });
});
