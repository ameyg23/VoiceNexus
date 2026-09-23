import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { Intent, MfaMethod } from "@voice-nexus/shared";
import { speakDate } from "./dates.js";

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
  last_payment_date: string | null;
  next_billing_due_date: string | null;
  past_due_amount: number;
  discount_percent: number;
  autopay_enabled: number;
  plan_name: string;
  account_status: string;
  portal_password_hash: string | null;
  service_zip: string | null;
  phone_number: string;
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

// Post-auth intent fulfillment (ARCHITECTURE.md §1/§11): the server decides which fields are
// authorized for a given intent and fetches only those — never the whole customer row, and never
// delegated to the AI. `phraseResponseAI` (aiEngine.ts) only turns this pre-cleared data into
// natural language; it never chooses what to include.
export interface IntentResponseData {
  instruction: string;
  data: Record<string, unknown> | null;
  fallbackText: string;
}

// Read-only intents only: anything that changes the account goes through a confirmation subflow in
// authStateMachine.ts first (PRD "Confirm before committing").
export type InfoIntent = Extract<Intent, "CHECK_BALANCE" | "PAYMENT_HISTORY" | "BILLING_DUE_DATE" | "PLAN_INFO" | "AUTOPAY_STATUS">;

export function getIntentResponseData(customer: CustomerRow, intent: InfoIntent): IntentResponseData {
  switch (intent) {
    case "CHECK_BALANCE":
      return {
        instruction: "Tell the caller their current account balance, and their past-due amount if it's non-zero.",
        data: { currentBalance: customer.current_balance, pastDueAmount: customer.past_due_amount },
        fallbackText:
          customer.past_due_amount > 0
            ? `Your current balance is $${customer.current_balance.toFixed(2)}, including $${customer.past_due_amount.toFixed(2)} past due.`
            : `Your current balance is $${customer.current_balance.toFixed(2)}.`,
      };

    case "PAYMENT_HISTORY":
      return {
        instruction: "Tell the caller the amount and date of their last payment.",
        data: { lastPaymentAmount: customer.last_payment_amount, lastPaymentDate: customer.last_payment_date },
        fallbackText: customer.last_payment_date
          ? `Your last payment was $${customer.last_payment_amount.toFixed(2)} on ${speakDate(customer.last_payment_date)}.`
          : "I don't see any payments on your account yet.",
      };

    case "BILLING_DUE_DATE":
      return {
        instruction: "Tell the caller when their next bill is due, and their current balance.",
        data: { nextBillingDueDate: customer.next_billing_due_date, currentBalance: customer.current_balance },
        fallbackText: customer.next_billing_due_date
          ? `Your next bill of $${customer.current_balance.toFixed(2)} is due on ${speakDate(customer.next_billing_due_date)}.`
          : "You don't have a bill scheduled yet.",
      };

    case "PLAN_INFO":
      return {
        instruction: "Tell the caller their plan name, and their discount percent if it's non-zero.",
        data: { planName: customer.plan_name, discountPercent: customer.discount_percent },
        fallbackText:
          customer.discount_percent > 0
            ? `You're on the ${customer.plan_name} plan with a ${customer.discount_percent}% discount applied.`
            : `You're on the ${customer.plan_name} plan.`,
      };

    case "AUTOPAY_STATUS":
      return {
        instruction: "Tell the caller whether autopay is currently on or off for their account.",
        data: { autopayEnabled: Boolean(customer.autopay_enabled) },
        fallbackText: customer.autopay_enabled ? "Autopay is currently on for your account." : "Autopay is currently off for your account.",
      };

  }
}

function applySimulatedPayment(customerId: string, amount: number): void {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    UPDATE customers
    SET current_balance = 0, past_due_amount = 0, last_payment_amount = @amount, last_payment_date = @today
    WHERE id = @id
  `).run({ "@amount": amount, "@today": today, "@id": customerId });
}

// --- Plan catalog (PLAN_CHANGE subflow). Monthly prices are the demo operator's list prices. ---

export interface PlanInfo {
  name: string;
  monthlyPrice: number;
  description: string;
}

export const PLAN_CATALOG: PlanInfo[] = [
  { name: "Starter", monthlyPrice: 30, description: "100 Mbps internet" },
  { name: "Cable Basic", monthlyPrice: 45, description: "basic cable TV, no internet" },
  { name: "Fiber 300", monthlyPrice: 55, description: "300 Mbps fiber internet" },
  { name: "Fiber 500", monthlyPrice: 70, description: "500 Mbps fiber internet" },
  { name: "Fiber 1000", monthlyPrice: 90, description: "1 gig fiber internet" },
  { name: "Fiber 500 + TV", monthlyPrice: 110, description: "500 Mbps fiber plus TV" },
  { name: "Fiber 1000 + TV", monthlyPrice: 130, description: "1 gig fiber plus TV" },
];

export function findPlan(name: string): PlanInfo | undefined {
  return PLAN_CATALOG.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

// Deterministic plan matching from speech ("the one gig plan with TV", "fiber five hundred").
export function matchPlanFromText(text: string): PlanInfo | null {
  const t = text.toLowerCase();
  const tv = /\b(tv|television|cable tv|channels)\b/.test(t) && !/\bno tv\b|\bwithout tv\b/.test(t);
  let speed: 300 | 500 | 1000 | null = null;
  if (/\b(1000|1,000|thousand|gig|gigabit|1 ?g)\b/.test(t)) speed = 1000;
  else if (/\b(500|five hundred)\b/.test(t)) speed = 500;
  else if (/\b(300|three hundred)\b/.test(t)) speed = 300;

  if (speed) return findPlan(`Fiber ${speed}${tv ? " + TV" : ""}`) ?? findPlan(`Fiber ${speed}`) ?? null;
  if (/\bstarter\b/.test(t)) return findPlan("Starter") ?? null;
  if (/\b(cable basic|basic cable|just tv|tv only)\b/.test(t)) return findPlan("Cable Basic") ?? null;
  return null;
}

export function applyPlanChange(customerId: string, planName: string): void {
  db.prepare(`UPDATE customers SET plan_name = @plan WHERE id = @id`).run({ "@plan": planName, "@id": customerId });
}

export function applyPayment(customerId: string, amount: number): void {
  applySimulatedPayment(customerId, amount);
}

// --- Outages (OUTAGE_CHECK, and checked before any tech troubleshooting) ---

export interface OutageRow {
  id: number;
  service_zip: string;
  description: string;
  eta: string | null;
}

export function findActiveOutage(serviceZip: string | null | undefined): OutageRow | undefined {
  if (!serviceZip) return undefined;
  return db
    .prepare(`SELECT id, service_zip, description, eta FROM outages WHERE service_zip = @zip AND active = 1 ORDER BY id DESC LIMIT 1`)
    .get({ "@zip": serviceZip }) as OutageRow | undefined;
}
