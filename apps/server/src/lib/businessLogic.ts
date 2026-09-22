import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { MfaMethod } from "@voice-nexus/shared";

export interface CustomerRow {
  id: string;
  name: string;
  ban: string;
  pin_hash: string;
  email: string;
  mfa_enabled: number;
  mfa_method: MfaMethod;
  current_balance: number;
  last_payment_amount: number;
  last_payment_date: string;
  next_billing_due_date: string;
  past_due_amount: number;
  discount_percent: number;
  autopay_enabled: number;
  plan_name: string;
  account_status: string;
}

export function findCustomerByBan(ban: string): CustomerRow | undefined {
  return db.prepare(`SELECT * FROM customers WHERE ban = @ban`).get({ "@ban": ban }) as CustomerRow | undefined;
}

export function findCustomerById(id: string): CustomerRow | undefined {
  return db.prepare(`SELECT * FROM customers WHERE id = @id`).get({ "@id": id }) as CustomerRow | undefined;
}

export function verifyPin(customer: CustomerRow, pin: string): boolean {
  return bcrypt.compareSync(pin, customer.pin_hash);
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const visible = user.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(user.length - 1, 1))}@${domain}`;
}
