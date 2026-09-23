import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { Intent, MfaMethod } from "@voice-nexus/shared";

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
  portal_password_hash: string | null;
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

export function getIntentResponseData(customer: CustomerRow, intent: Intent): IntentResponseData {
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
        fallbackText: `Your last payment was $${customer.last_payment_amount.toFixed(2)} on ${customer.last_payment_date}.`,
      };

    case "BILLING_DUE_DATE":
      return {
        instruction: "Tell the caller when their next bill is due, and their current balance.",
        data: { nextBillingDueDate: customer.next_billing_due_date, currentBalance: customer.current_balance },
        fallbackText: `Your next bill of $${customer.current_balance.toFixed(2)} is due on ${customer.next_billing_due_date}.`,
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

    case "MAKE_PAYMENT": {
      const amount = customer.current_balance;
      if (amount <= 0) {
        return {
          instruction: "Tell the caller their balance is already zero, so there's nothing to pay right now.",
          data: { currentBalance: 0 },
          fallbackText: "Your balance is already $0.00 — there's nothing to pay right now.",
        };
      }
      applySimulatedPayment(customer.id, amount);
      return {
        instruction: "Confirm the caller's payment was processed successfully, and state the amount paid.",
        data: { amountPaid: amount },
        fallbackText: `Payment of $${amount.toFixed(2)} received — thank you, your balance is now settled.`,
      };
    }

    case "TECH_TRIAGE":
      return {
        instruction:
          "Walk the caller through basic troubleshooting: power-cycle the modem/router (unplug 30 seconds, plug back in) and check cable connections, then say a technician can be dispatched if that doesn't help.",
        data: null,
        fallbackText:
          "Let's try power-cycling your modem and router — unplug them for about 30 seconds, then plug them back in and check the cables are seated firmly. If that doesn't help, I can get a technician dispatched.",
      };

    case "UNKNOWN":
    default:
      return {
        instruction: "Ask the caller to clarify what they'd like help with today (balance, payment, billing date, plan, autopay, or a technical issue).",
        data: null,
        fallbackText: "Sorry, I didn't quite catch what you need — could you tell me if this is about your balance, a payment, your plan, or a technical issue?",
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
