import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import { nextCustomerId, nextBan } from "../lib/ids.js";
import { hashPassword, verifyPassword, setCustomerSession, clearCustomerSession, requireCustomerAuth } from "../lib/auth.js";
import type { CustomerRow } from "../lib/businessLogic.js";

export const customerAuthRouter = Router();

function toPublic(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ban: row.ban,
    planName: row.plan_name,
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
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
});

// POST /api/auth/customer/signup — creates a brand-new customer account (its own BAN + PIN,
// separate from the demo-seeded customers). `password` is the web portal login; `pin` is the
// SAME 4-digit PIN used to authenticate over a phone call (authStateMachine.ts) — signup sets up
// both at once so the new account is immediately usable on both surfaces. Deliberately NOT linked
// to any existing seeded customer by email match — several seed rows intentionally share one
// inbox for OTP testing (CLAUDE.md), so email isn't a safe join key there.
customerAuthRouter.post("/signup", (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, password, pin } = parsed.data;

  const existing = db
    .prepare(`SELECT id FROM customers WHERE email = @email AND portal_password_hash IS NOT NULL`)
    .get({ "@email": email });
  if (existing) return res.status(409).json({ error: "a portal account with that email already exists" });

  const id = nextCustomerId();
  const ban = nextBan();
  const phoneNumber = `+1555${id.replace(/\D/g, "").padStart(6, "0")}`;
  const pinHash = bcrypt.hashSync(pin, 10);
  const portalPasswordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO customers (
      id, name, phone_number, ban, pin_hash, email, mfa_enabled, mfa_method,
      current_balance, last_payment_amount, last_payment_date, next_billing_due_date,
      past_due_amount, discount_percent, autopay_enabled, plan_name, account_status,
      portal_password_hash
    ) VALUES (
      @id, @name, @phone, @ban, @pinHash, @email, 0, 'NONE',
      0, 0, NULL, NULL,
      0, 0, 0, 'Starter', 'ACTIVE',
      @portalHash
    )
  `).run({
    "@id": id,
    "@name": name,
    "@phone": phoneNumber,
    "@ban": ban,
    "@pinHash": pinHash,
    "@email": email,
    "@portalHash": portalPasswordHash,
  });

  const row = db.prepare(`SELECT * FROM customers WHERE id = @id`).get({ "@id": id }) as CustomerRow | undefined;
  setCustomerSession(res, id);
  res.status(201).json({ customer: toPublic(row!) });
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

customerAuthRouter.get("/me", requireCustomerAuth, (req, res) => {
  const row = db.prepare(`SELECT * FROM customers WHERE id = @id`).get({
    "@id": req.customer!.customerId,
  }) as CustomerRow | undefined;
  if (!row) return res.status(401).json({ error: "not authenticated" });
  res.json({ customer: toPublic(row) });
});
