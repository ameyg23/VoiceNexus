import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { CustomerType, Intent, MfaMethod } from "@voice-nexus/shared";
import { speakDate, speakRelativeDate } from "./dates.js";

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
      // When there's no payment yet, data is deliberately null rather than { lastPaymentAmount: 0,
      // lastPaymentDate: null } - a real bug, found live Oct 1: with both fields present but null/0,
      // phraseResponseAI's instruction didn't say what to do about the missing date, so it quietly
      // answered with whatever *other* field it could find on the customer (balance) instead of
      // addressing the question at all - from the caller's side, indistinguishable from the assistant
      // ignoring them. Giving it nothing to work with but an explicit "say there's no history yet"
      // instruction removes that failure mode entirely, same pattern TECH_TRIAGE already uses.
      if (!customer.last_payment_date) {
        return {
          instruction: "The caller has no payment history yet. Tell them plainly that you don't see any payments on their account yet.",
          data: null,
          fallbackText: "I don't see any payments on your account yet.",
        };
      }
      // "today"/"yesterday" close to the payment date, the actual date otherwise - computed server-side
      // (speakRelativeDate) and handed to the AI as the literal words to use, not a date for it to do
      // relative math on itself (user request, Oct 1: "if I create an account today and ask my last
      // payment date it should say today... tomorrow it should say yesterday... after 15 days the date").
      const paidWhen = speakRelativeDate(customer.last_payment_date);
      return {
        instruction: `Tell the caller the amount of their last payment and when it was made. Use exactly this wording for when it was made: "${paidWhen}" - don't convert it to a calendar date yourself.`,
        data: { lastPaymentAmount: customer.last_payment_amount, lastPaymentWhen: paidWhen },
        fallbackText: `Your last payment was $${customer.last_payment_amount.toFixed(2)}, made ${paidWhen}.`,
      };

    case "BILLING_DUE_DATE":
      // Same fix as PAYMENT_HISTORY above, and the same real bug it was found alongside: with no due
      // date on file, don't hand the AI a currentBalance figure to fall back on answering instead.
      return customer.next_billing_due_date
        ? {
            instruction: "Tell the caller when their next bill is due, and their current balance.",
            data: { nextBillingDueDate: customer.next_billing_due_date, currentBalance: customer.current_balance },
            fallbackText: `Your next bill of $${customer.current_balance.toFixed(2)} is due on ${speakDate(customer.next_billing_due_date)}.`,
          }
        : {
            instruction: "The caller has no bill scheduled yet. Tell them plainly that there's no bill due yet.",
            data: null,
            fallbackText: "You don't have a bill scheduled yet.",
          };

    case "PLAN_INFO": {
      // Full picture, not just the plan's name (user request, Oct 1: "it should tell everything about
      // the plan like the plan name, the price, benefits, the services... etc") - monthlyPrice and
      // description come from the same PLAN_CATALOG the phone PLAN_CHANGE subflow and the portal's
      // plan picker already use, so this can never drift out of sync with what the plan actually costs
      // or includes.
      const plan = findPlan(customer.plan_name);
      const planLine = plan
        ? `You're on the ${customer.plan_name} plan: ${plan.description}, for $${plan.monthlyPrice.toFixed(2)} a month.`
        : `You're on the ${customer.plan_name} plan.`;
      return {
        instruction: "Tell the caller their plan name, what it includes, and its monthly price, and their discount percent if it's non-zero.",
        data: { planName: customer.plan_name, monthlyPrice: plan?.monthlyPrice, whatsIncluded: plan?.description, discountPercent: customer.discount_percent },
        fallbackText:
          customer.discount_percent > 0 ? `${planLine} You also have a ${customer.discount_percent}% discount applied.` : planLine,
      };
    }

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

// Same two picks the web portal badges as "Most Popular"/"Best Value" (apps/web/lib/marketingContent.ts's
// PLAN_BADGES) - kept in sync by hand since phone and web are separate codebases, but deliberately the
// same two plans so a caller never hears a different recommendation than what the website shows.
export const PLAN_HIGHLIGHTS: Record<string, "Most Popular" | "Best Value"> = {
  "Fiber 500": "Most Popular",
  "Fiber 1000": "Best Value",
  "Business 500": "Most Popular",
  "Business 1000": "Best Value",
};

// A brief, spoken recommendation - just the catalog's two highlighted plans, never the full list (user
// request, Oct 1: "it should not tell everything... only say this is the most popular plan, this is
// the best value plan... in brief"). Used both for an existing caller asking "which plan is best for
// me" and a not-yet-a-customer asking "which plan should I buy."
export function planRecommendationText(audience: CustomerType): string {
  const plans = PLAN_CATALOG.filter((p) => p.audience === audience);
  const headline = (p: PlanInfo) => p.description.split(",")[0];
  const popular = plans.find((p) => PLAN_HIGHLIGHTS[p.name] === "Most Popular");
  const bestValue = plans.find((p) => PLAN_HIGHLIGHTS[p.name] === "Best Value");
  const parts: string[] = [];
  if (popular) parts.push(`Our most popular plan is ${popular.name}, ${headline(popular)}, for $${popular.monthlyPrice} a month.`);
  if (bestValue) parts.push(`For the best value, there's ${bestValue.name}, ${headline(bestValue)}, for $${bestValue.monthlyPrice} a month.`);
  if (parts.length) return parts.join(" ");
  // Fallback if an audience's catalog ever has no highlighted plans - still brief, not the full list.
  return `Our plans for ${audience === "BUSINESS" ? "business" : "home"} start at $${Math.min(...plans.map((p) => p.monthlyPrice))} a month.`;
}

export interface PlanSuggestion {
  text: string;
  // The plan to switch to, so the caller can go straight into the existing yes/no confirm step - or
  // null when the answer is "stay," which needs no confirmation of anything.
  suggestedPlan: string | null;
}

// Personalized version of the above for a caller who already has a plan (user request, Oct 1: "it
// should consider my plan and compare other plans... if my plan is not better, tell me this plan is
// better, you can switch... if my plan is better, tell me your plan is better, you should stay").
// "Better" is deliberately simple, not a multi-attribute comparison: the catalog's own "Best Value"
// pick for their audience is the one upsell target. If they're already on it, or on something that
// costs as much or more (the two "+TV" bundles, which genuinely cost more), there's nothing to upsell
// to, so the honest answer is "stay." Otherwise that one plan is the suggestion, with a one-line reason
// and the exact price difference, not a generic pitch.
export function suggestBetterPlan(customer: CustomerRow): PlanSuggestion {
  const current = findPlan(customer.plan_name);
  if (!current) return { text: "I don't see a plan on your account to compare.", suggestedPlan: null };
  const bestValue = PLAN_CATALOG.find((p) => p.audience === customer.customer_type && PLAN_HIGHLIGHTS[p.name] === "Best Value");
  const headline = (p: PlanInfo) => p.description.split(",")[0];
  if (!bestValue || current.name === bestValue.name || current.monthlyPrice >= bestValue.monthlyPrice) {
    return {
      text: `You're on ${current.name}, ${headline(current)}, for $${current.monthlyPrice} a month - that's already one of our best plans, so I'd say stick with what you have.`,
      suggestedPlan: null,
    };
  }
  const extra = bestValue.monthlyPrice - current.monthlyPrice;
  return {
    text: `You're currently on ${current.name}, ${headline(current)}, for $${current.monthlyPrice} a month. I'd recommend ${bestValue.name} instead - ${headline(bestValue)} - for just $${extra} more a month. Would you like to switch?`,
    suggestedPlan: bestValue.name,
  };
}

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
