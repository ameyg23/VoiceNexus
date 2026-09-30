import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { CustomerType, Intent, MfaMethod } from "@voice-nexus/shared";
import { speakDate } from "./dates.js";

export interface CustomerRow {
  id: string;
  name: string;
  ban: string;
  pin_hash: string;
  email: string;
  mfa_enabled: number;
  mfa_method: MfaMethod;
  customer_type: CustomerType;
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
  mfa_phone_number: string | null;
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

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : "***";
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
  audience: CustomerType;
}

// Residential and business are genuinely separate product lines (found and fixed Sep 30 - the
// catalog used to be one flat residential-shaped list, so every business-tagged customer_type was
// silently offered and sold residential plans, on the phone and on the web alike). Business plans add
// a static IP and priority support, which is the real differentiator ISPs sell on, not just a relabel.
export const PLAN_CATALOG: PlanInfo[] = [
  { name: "Starter", monthlyPrice: 30, description: "100 Mbps internet", audience: "RESIDENTIAL" },
  { name: "Cable Basic", monthlyPrice: 45, description: "basic cable TV, no internet", audience: "RESIDENTIAL" },
  { name: "Fiber 300", monthlyPrice: 55, description: "300 Mbps fiber internet", audience: "RESIDENTIAL" },
  { name: "Fiber 500", monthlyPrice: 70, description: "500 Mbps fiber internet", audience: "RESIDENTIAL" },
  { name: "Fiber 1000", monthlyPrice: 90, description: "1 gig fiber internet", audience: "RESIDENTIAL" },
  { name: "Fiber 500 + TV", monthlyPrice: 110, description: "500 Mbps fiber plus TV", audience: "RESIDENTIAL" },
  { name: "Fiber 1000 + TV", monthlyPrice: 130, description: "1 gig fiber plus TV", audience: "RESIDENTIAL" },
  { name: "Business 300", monthlyPrice: 89, description: "300 Mbps fiber internet, static IP, priority support", audience: "BUSINESS" },
  { name: "Business 500", monthlyPrice: 119, description: "500 Mbps fiber internet, static IP, priority support", audience: "BUSINESS" },
  { name: "Business 1000", monthlyPrice: 179, description: "1 gig fiber internet, static IP, priority support, 24/7 priority line", audience: "BUSINESS" },
];

export function findPlan(name: string): PlanInfo | undefined {
  return PLAN_CATALOG.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

// Deterministic plan matching from speech ("the one gig plan with TV", "fiber five hundred").
// Audience-scoped (default residential) so a business caller saying "the 500 plan" matches Business
// 500, not the similarly-priced residential Fiber 500 - the two are different products at different
// price points, not the same plan under two names.
export function matchPlanFromText(text: string, audience: CustomerType = "RESIDENTIAL"): PlanInfo | null {
  const t = text.toLowerCase();
  let speed: 300 | 500 | 1000 | null = null;
  if (/\b(1000|1,000|thousand|gig|gigabit|1 ?g|fastest|quickest|top speed)\b/.test(t)) speed = 1000;
  else if (/\b(500|five hundred)\b/.test(t)) speed = 500;
  else if (/\b(300|three hundred)\b/.test(t)) speed = 300;

  if (audience === "BUSINESS") return speed ? (findPlan(`Business ${speed}`) ?? null) : null;

  const mentionsTv = /\b(tv|television|cable tv|channels)\b/.test(t);
  // "no TV", "without TV", "I don't need television", "not the TV one"
  const negatedTv = /\b(no|without|not|don'?t (need|want)|do not (need|want)|skip( the)?)\b[\w\s']{0,12}\b(tv|television|channels)\b/.test(t);
  const tv = mentionsTv && !negatedTv;

  if (speed) return findPlan(`Fiber ${speed}${tv ? " + TV" : ""}`) ?? findPlan(`Fiber ${speed}`) ?? null;
  if (/\bstarter\b/.test(t)) return findPlan("Starter") ?? null;
  if (/\b(cable basic|basic cable|just tv|tv only)\b/.test(t)) return findPlan("Cable Basic") ?? null;
  return null;
}

// Simulated proration, same "fake money, real logic" posture as applyPayment/MAKE_PAYMENT - no real
// billing gateway exists in this POC (user request, Sep 30: "let's keep the money thing as fake").
// The existing balance always carries over to the new plan (it's not wiped by switching); on an
// upgrade, the price difference is added on top so the customer owes the gap immediately rather than
// waiting for a bill to catch up. A downgrade adds nothing - no credit/refund model, just no charge.
// Shared by both channels (phone PLAN_CHANGE and the web portal's self-service switch) so a plan
// switch behaves identically either way.
export function applyPlanChange(customerId: string, planName: string): { newBalance: number; charged: number } {
  const customer = findCustomerById(customerId)!;
  const currentPrice = findPlan(customer.plan_name)?.monthlyPrice ?? 0;
  const targetPrice = findPlan(planName)?.monthlyPrice ?? 0;
  const charged = Math.max(0, targetPrice - currentPrice);
  const newBalance = customer.current_balance + charged;
  db.prepare(`UPDATE customers SET plan_name = @plan, current_balance = @balance WHERE id = @id`).run({
    "@plan": planName,
    "@balance": newBalance,
    "@id": customerId,
  });
  return { newBalance, charged };
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

// --- Service coverage (SERVICE_AVAILABILITY, new-customer flow) ---

export interface ServiceAreaRow {
  zip: string;
  residential_available: number;
  business_available: number;
}

// A ZIP we have no row for is treated as not (yet) covered, rather than guessing.
export function findServiceArea(zip: string): ServiceAreaRow | undefined {
  return db.prepare(`SELECT * FROM service_areas WHERE zip = @zip`).get({ "@zip": zip }) as ServiceAreaRow | undefined;
}

export function isServiceAvailable(zip: string, accountType: CustomerType): boolean {
  const area = findServiceArea(zip);
  if (!area) return false;
  return accountType === "BUSINESS" ? Boolean(area.business_available) : Boolean(area.residential_available);
}
