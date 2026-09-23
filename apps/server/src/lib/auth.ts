// Two independent auth systems, deliberately kept separate end to end (own cookie name, own JWT
// audience, own DB table) so a customer session can never be mistaken for an employee session or
// vice versa — there's no shared "user" table or role flag to get crossed.
//
// This is unrelated to the phone-call BAN+PIN/OTP auth (authStateMachine.ts) — that authenticates
// a caller mid-call for account access; this is a web login for the customer self-service portal
// and the employee ops dashboard.

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { EmployeeRole } from "@voice-nexus/shared";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export const EMPLOYEE_COOKIE = "vn_employee_session";
export const CUSTOMER_COOKIE = "vn_customer_session";

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

interface EmployeeTokenPayload {
  aud: "employee";
  employeeId: number;
  role: EmployeeRole;
}

interface CustomerTokenPayload {
  aud: "customer";
  customerId: string;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // local-only dev over http (ARCHITECTURE.md zero-cost/local POC); set true behind HTTPS
    path: "/",
    maxAge: SESSION_DURATION_MS,
  };
}

export function setEmployeeSession(res: Response, employeeId: number, role: EmployeeRole) {
  const token = jwt.sign({ aud: "employee", employeeId, role } satisfies EmployeeTokenPayload, JWT_SECRET, {
    expiresIn: "7d",
  });
  res.cookie(EMPLOYEE_COOKIE, token, cookieOptions());
}

export function setCustomerSession(res: Response, customerId: string) {
  const token = jwt.sign({ aud: "customer", customerId } satisfies CustomerTokenPayload, JWT_SECRET, {
    expiresIn: "7d",
  });
  res.cookie(CUSTOMER_COOKIE, token, cookieOptions());
}

export function clearEmployeeSession(res: Response) {
  res.clearCookie(EMPLOYEE_COOKIE, { path: "/" });
}

export function clearCustomerSession(res: Response) {
  res.clearCookie(CUSTOMER_COOKIE, { path: "/" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      employee?: { employeeId: number; role: EmployeeRole };
      customer?: { customerId: string };
    }
  }
}

export function requireEmployeeAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[EMPLOYEE_COOKIE];
  if (!token) return res.status(401).json({ error: "not authenticated" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as EmployeeTokenPayload;
    if (payload.aud !== "employee") throw new Error("wrong audience");
    req.employee = { employeeId: payload.employeeId, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired session" });
  }
}

export function requireCustomerAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[CUSTOMER_COOKIE];
  if (!token) return res.status(401).json({ error: "not authenticated" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as CustomerTokenPayload;
    if (payload.aud !== "customer") throw new Error("wrong audience");
    req.customer = { customerId: payload.customerId };
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired session" });
  }
}
