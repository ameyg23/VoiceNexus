import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import { nextCustomerId, nextBan } from "../lib/ids.js";
import { hashPassword, verifyPassword, setCustomerSession, clearCustomerSession, requireCustomerAuth } from "../lib/auth.js";
import { PLAN_CATALOG, findPlan, isServiceAvailable, type CustomerRow } from "../lib/businessLogic.js";
import { describeAction, safeJson, type CallActionRow } from "../lib/actions.js";
import { OUTCOME_SQL, sqliteUtcToIso } from "../lib/outcome.js";
import { getSettings } from "../lib/settings.js";

export const customerAuthRouter = Router();

function toPublic(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ban: row.ban,
    planName: row.plan_name,
    customerType: row.customer_type,
    accountStatus: row.account_status,
    currentBalance: row.current_balance,
    pastDueAmount: row.past_due_amount,
    lastPaymentAmount: row.last_payment_amount,
    lastPaymentDate: row.last_payment_date,
    nextBillingDueDate: row.next_billing_due_date,
    autopayEnabled: Boolean(row.autopay_enabled),
    discountPercent: row.discount_percent,
  };
}

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

// POST /api/auth/customer/signup — creates a bare web-login account only: no BAN, no plan, no phone
// PIN yet (user decision, Sep 30 — "a new customer... should be simply able to create the account
// with the help of email and password... once they click in, they can buy the services"). Marked
// `account_status = 'PROSPECT'` until they buy a plan via POST /purchase-plan below, which is the
// step that actually makes them a customer (assigns a real BAN + a phone PIN they're shown once).
// `ban`/`plan_name` get real-but-inert placeholders here — `ban` in particular is a sentinel
// (`PENDING-<id>`) that can never collide with a real spoken/typed 6-digit BAN, so a prospect is
// never phone-reachable via findCustomerByBan until they actually purchase. No schema change needed:
// nextBan()'s counter query CASTs the sentinel's tail to an integer, which SQLite reads as 0, so it
// can't corrupt the BAN sequence for real customers either.
// An email already on any customer (or employee) is refused — emails are unique (migration 004).
customerAuthRouter.post("/signup", (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, password } = parsed.data;

  const existing = db
    .prepare(`SELECT id FROM customers WHERE lower(email) = lower(@email)`)
    .get({ "@email": email });
  const isEmployee = db.prepare(`SELECT id FROM employees WHERE lower(email) = lower(@email)`).get({ "@email": email });
  if (existing || isEmployee) return res.status(409).json({ error: "an account with that email already exists" });

  const id = nextCustomerId();
  const phoneNumber = `+1555${id.replace(/\D/g, "").padStart(6, "0")}`;
  const pendingBan = `PENDING-${id}`;
  const throwawayPinHash = bcrypt.hashSync(crypto.randomUUID(), 10); // unreachable: sentinel BAN can never be looked up
  const portalPasswordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO customers (
      id, name, phone_number, ban, pin_hash, email, mfa_enabled, mfa_method,
      current_balance, last_payment_amount, last_payment_date, next_billing_due_date,
      past_due_amount, discount_percent, autopay_enabled, plan_name, account_status,
      portal_password_hash, service_zip
    ) VALUES (
      @id, @name, @phone, @ban, @pinHash, @email, 0, 'NONE',
      0, 0, NULL, NULL,
      0, 0, 0, '', 'PROSPECT',
      @portalHash, NULL
    )
  `).run({
    "@id": id,
    "@name": name,
    "@phone": phoneNumber,
    "@ban": pendingBan,
    "@pinHash": throwawayPinHash,
    "@email": email,
    "@portalHash": portalPasswordHash,
  });

  const row = db.prepare(`SELECT * FROM customers WHERE id = @id`).get({ "@id": id }) as CustomerRow | undefined;
  setCustomerSession(res, id);
  res.status(201).json({ customer: toPublic(row!) });
});

const purchasePlanSchema = z.object({ planName: z.string().min(1) });

// POST /api/auth/customer/purchase-plan — the step that actually turns a web-only signup into a real
// customer: simulated (no real payment gateway, matching how MAKE_PAYMENT is simulated on calls).
// Assigns a real BAN and a freshly-generated 4-digit phone PIN, returned in plaintext exactly once so
// the customer can note it down — every other endpoint only ever works with the bcrypt hash. Existing
// active customers can't call this to self-service a plan change; that stays phone/agent-only by
// design (portal already only offers "Call to switch" for its Available Plans section).
customerAuthRouter.post("/purchase-plan", requireCustomerAuth, (req, res) => {
  const parsed = purchasePlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customerId = req.customer!.customerId;
  const row = db.prepare(`SELECT * FROM customers WHERE id = @id`).get({ "@id": customerId }) as CustomerRow | undefined;
  if (!row) return res.status(401).json({ error: "not authenticated" });
  if (row.account_status !== "PROSPECT") {
    return res.status(400).json({ error: "this account already has an active plan. Call customer care to change it" });
  }

  const plan = findPlan(parsed.data.planName);
  if (!plan) return res.status(400).json({ error: "unknown plan" });

  const ban = nextBan();
  const pin = crypto.randomInt(1000, 10000).toString();
  const pinHash = bcrypt.hashSync(pin, 10);

  // customer_type follows whichever plan was actually bought (found and fixed Sep 30 - this used to
  // be left at the column's RESIDENTIAL default no matter what, so every web-purchased business
  // customer was silently mis-tagged as residential). The phone new-customer flow asks this
  // explicitly; the web flow infers it from the plan itself since residential/business are now
  // separate product lines in PLAN_CATALOG.
  db.prepare(`
    UPDATE customers
    SET ban = @ban, pin_hash = @pinHash, plan_name = @planName, account_status = 'ACTIVE', customer_type = @customerType
    WHERE id = @id
  `).run({ "@ban": ban, "@pinHash": pinHash, "@planName": plan.name, "@customerType": plan.audience, "@id": customerId });

  res.status(201).json({ ban, pin, planName: plan.name });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

customerAuthRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const row = db
    .prepare(`SELECT * FROM customers WHERE email = @email AND portal_password_hash IS NOT NULL`)
    .get({ "@email": parsed.data.email }) as CustomerRow | undefined;

  if (!row || !row.portal_password_hash || !verifyPassword(parsed.data.password, row.portal_password_hash)) {
    return res.status(401).json({ error: "invalid email or password" });
  }

  setCustomerSession(res, row.id);
  res.json({ customer: toPublic(row) });
});

customerAuthRouter.post("/logout", (_req, res) => {
  clearCustomerSession(res);
  res.json({ ok: true });
});

// GET /api/auth/customer/activity — the signed-in customer's own bookings, account changes and recent
// calls, for the self-service portal. Scoped strictly to req.customer; no transcripts or internal notes.
customerAuthRouter.get("/activity", requireCustomerAuth, (req, res) => {
  const customerId = req.customer!.customerId;
  const actions = db
    .prepare(`SELECT * FROM call_actions WHERE customer_id = @id AND status <> 'CANCELLED' ORDER BY id DESC LIMIT 50`)
    .all({ "@id": customerId }) as unknown as CallActionRow[];
  const view = (a: CallActionRow) => ({
    id: a.id,
    type: a.type,
    status: a.status,
    scheduledFor: a.scheduled_for,
    window: (safeJson(a.details).windowLabel as string | undefined) ?? null,
    description: describeAction(a),
    createdAt: sqliteUtcToIso(a.created_at),
  });
  const calls = db
    .prepare(
      `SELECT c.id, c.start_time as startTime, c.detected_intent as intent, ${OUTCOME_SQL} as outcome
       FROM conversations c WHERE c.customer_id = @id ORDER BY c.start_time DESC LIMIT 5`
    )
    .all({ "@id": customerId });
  const s = getSettings();
  res.json({
    upcoming: actions.filter((a) => a.status === "SCHEDULED").map(view),
    history: actions.filter((a) => a.status !== "SCHEDULED").slice(0, 10).map(view),
    recentCalls: calls,
    brandName: s.brandName,
    assistantName: s.assistantName,
    careLineNumber: process.env.TWILIO_CARE_LINE_NUMBER ?? null,
  });
});

// GET /api/auth/customer/plans — the same catalog the phone AI offers in the PLAN_CHANGE subflow
// (businessLogic.ts), so "view plans" in the portal always matches what a call would actually offer.
customerAuthRouter.get("/plans", requireCustomerAuth, (_req, res) => {
  res.json({ plans: PLAN_CATALOG });
});

// GET /api/auth/customer/service-availability?zip=XXXXX&accountType=RESIDENTIAL|BUSINESS — the same
// `service_areas` lookup the phone flow's NEW_CUSTOMER_ZIP/EXISTING_SERVICE_ZIP subflows use
// (businessLogic.ts::isServiceAvailable), exposed for the get-started page's instant availability
// checker (user request, Sep 30: "put our availability into some areas... when they enter their area,
// we can answer them from there itself" — modeled on fidiumfiber.com's address checker). A ZIP with no
// row is treated as not (yet) covered, same "never guess" rule as the phone flow.
customerAuthRouter.get("/service-availability", requireCustomerAuth, (req, res) => {
  const zip = String(req.query.zip ?? "").trim();
  const accountType = req.query.accountType === "BUSINESS" ? "BUSINESS" : "RESIDENTIAL";
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: "enter a 5-digit ZIP code" });
  res.json({ zip, accountType, available: isServiceAvailable(zip, accountType) });
});

customerAuthRouter.get("/me", requireCustomerAuth, (req, res) => {
  const row = db.prepare(`SELECT * FROM customers WHERE id = @id`).get({
    "@id": req.customer!.customerId,
  }) as CustomerRow | undefined;
  if (!row) return res.status(401).json({ error: "not authenticated" });
  res.json({ customer: toPublic(row) });
});
