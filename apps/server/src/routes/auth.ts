// Unified website login: one form for everyone. The server works out which kind of account the
// credentials belong to and starts that session — employees land on the ops dashboard, customers on
// their self-service account page. The two session types themselves stay fully separate (own cookie,
// own JWT audience, own table — see lib/auth.ts); this route only picks which one to issue.

import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { db } from "@voice-nexus/db";
import type { EmployeeRole } from "@voice-nexus/shared";
import {
  verifyPassword,
  setEmployeeSession,
  setCustomerSession,
  clearEmployeeSession,
  clearCustomerSession,
  EMPLOYEE_COOKIE,
  CUSTOMER_COOKIE,
  jwtSecret,
} from "../lib/auth.js";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

// POST /api/auth/login → { accountType, redirectTo }. Employees are checked first; an email is never
// both (customer signup refuses employee emails) and is unique among customers (migration 004).
// Same 401 either way, so the response doesn't reveal whether an email exists or which kind it is.
authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "enter a valid email and password" });
  const { email, password } = parsed.data;

  const employee = db.prepare(`SELECT id, role, password_hash FROM employees WHERE lower(email) = @email`).get({ "@email": email }) as
    | { id: number; role: EmployeeRole; password_hash: string }
    | undefined;
  if (employee && verifyPassword(password, employee.password_hash)) {
    clearCustomerSession(res);
    setEmployeeSession(res, employee.id, employee.role);
    return res.json({ accountType: "employee", redirectTo: "/admin/dashboard" });
  }

  const customer = db
    .prepare(`SELECT id, portal_password_hash, account_status FROM customers WHERE lower(email) = @email AND portal_password_hash IS NOT NULL`)
    .get({ "@email": email }) as { id: string; portal_password_hash: string; account_status: string } | undefined;
  if (customer && verifyPassword(password, customer.portal_password_hash)) {
    clearEmployeeSession(res);
    setCustomerSession(res, customer.id);
    const redirectTo = customer.account_status === "PROSPECT" ? "/portal/get-started" : "/portal/account";
    return res.json({ accountType: "customer", redirectTo });
  }

  res.status(401).json({ error: "invalid email or password" });
});

// POST /api/auth/logout — ends whichever session is active.
authRouter.post("/logout", (_req, res) => {
  clearEmployeeSession(res);
  clearCustomerSession(res);
  res.json({ ok: true });
});

// GET /api/auth/session → { accountType, redirectTo } for an already signed-in visitor, so /login and
// /signup can send them straight to their home page. 401 when signed out.
authRouter.get("/session", (req, res) => {
  if (isValid(req.cookies?.[EMPLOYEE_COOKIE], "employee")) return res.json({ accountType: "employee", redirectTo: "/admin/dashboard" });
  const customerId = validCustomerId(req.cookies?.[CUSTOMER_COOKIE]);
  if (customerId) {
    const row = db.prepare(`SELECT account_status FROM customers WHERE id = @id`).get({ "@id": customerId }) as { account_status: string } | undefined;
    const redirectTo = row?.account_status === "PROSPECT" ? "/portal/get-started" : "/portal/account";
    return res.json({ accountType: "customer", redirectTo });
  }
  res.status(401).json({ error: "not signed in" });
});

function isValid(token: string | undefined, audience: "employee" | "customer"): boolean {
  if (!token) return false;
  try {
    return (jwt.verify(token, jwtSecret()) as { aud?: string }).aud === audience;
  } catch {
    return false;
  }
}

function validCustomerId(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret()) as { aud?: string; customerId?: string };
    return payload.aud === "customer" && payload.customerId ? payload.customerId : null;
  } catch {
    return null;
  }
}
