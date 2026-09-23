import { Router } from "express";
import { z } from "zod";
import { db } from "@voice-nexus/db";
import type { EmployeeRole } from "@voice-nexus/shared";
import { hashPassword, verifyPassword, setEmployeeSession, clearEmployeeSession, requireEmployeeAuth } from "../lib/auth.js";

export const employeeAuthRouter = Router();

interface EmployeeRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: EmployeeRole;
}

function toPublic(row: EmployeeRow) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

// POST /api/auth/employee/signup — single-company employee signup (no invite flow for this POC;
// see CLAUDE.md "Key decisions" — every signup gets ADMIN since there's no team-management UI yet
// to promote/demote AGENT/VIEWER accounts).
employeeAuthRouter.post("/signup", (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { name, email, password } = parsed.data;
  const existing = db.prepare(`SELECT id FROM employees WHERE email = @email`).get({ "@email": email });
  if (existing) return res.status(409).json({ error: "an account with that email already exists" });

  const passwordHash = hashPassword(password);
  const result = db
    .prepare(`INSERT INTO employees (name, email, password_hash, role) VALUES (@name, @email, @hash, 'ADMIN')`)
    .run({ "@name": name, "@email": email, "@hash": passwordHash });

  const employeeId = Number(result.lastInsertRowid);
  setEmployeeSession(res, employeeId, "ADMIN");
  res.status(201).json({ employee: { id: employeeId, name, email, role: "ADMIN" } });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

employeeAuthRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const row = db.prepare(`SELECT * FROM employees WHERE email = @email`).get({
    "@email": parsed.data.email,
  }) as EmployeeRow | undefined;

  if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
    return res.status(401).json({ error: "invalid email or password" });
  }

  setEmployeeSession(res, row.id, row.role);
  res.json({ employee: toPublic(row) });
});

employeeAuthRouter.post("/logout", (_req, res) => {
  clearEmployeeSession(res);
  res.json({ ok: true });
});

employeeAuthRouter.get("/me", requireEmployeeAuth, (req, res) => {
  const row = db.prepare(`SELECT * FROM employees WHERE id = @id`).get({
    "@id": req.employee!.employeeId,
  }) as EmployeeRow | undefined;
  if (!row) return res.status(401).json({ error: "not authenticated" });
  res.json({ employee: toPublic(row) });
});
