// Human-readable catalog of the fixed Intent enum (packages/shared), for the dashboard's Intents page.
// Intents are code-defined — classification (aiEngine.ts classifyIntentAI) and fulfillment
// (businessLogic.ts getIntentResponseData) both switch on this enum — so this is a read-only view,
// not an editable config.

import type { Intent } from "@voice-nexus/shared";

export interface IntentInfo {
  intent: Intent;
  label: string;
  description: string;
  examples: string[];
  // Account fields the server releases for this intent once the caller is verified.
  dataShared: string[];
}

export const INTENT_CATALOG: IntentInfo[] = [
  {
    intent: "CHECK_BALANCE",
    label: "Check Balance",
    description: "Current account balance, plus any past-due amount.",
    examples: ["What's my balance?", "How much do I owe?", "Am I behind on anything?"],
    dataShared: ["Current balance", "Past-due amount"],
  },
  {
    intent: "MAKE_PAYMENT",
    label: "Make Payment",
    description: "Simulated payment of the full balance — zeroes balance and past-due, stamps last payment.",
    examples: ["I want to pay my bill", "Pay off my balance", "Can I make a payment?"],
    dataShared: ["Amount paid"],
  },
  {
    intent: "PAYMENT_HISTORY",
    label: "Payment History",
    description: "Amount and date of the most recent payment.",
    examples: ["When did I last pay?", "Did my payment go through?", "What was my last payment?"],
    dataShared: ["Last payment amount", "Last payment date"],
  },
  {
    intent: "BILLING_DUE_DATE",
    label: "Billing Due Date",
    description: "When the next bill is due and how much it is.",
    examples: ["When is my bill due?", "What's my due date?", "When do I need to pay by?"],
    dataShared: ["Next billing due date", "Current balance"],
  },
  {
    intent: "PLAN_INFO",
    label: "Plan Info",
    description: "Current plan name and any discount applied.",
    examples: ["What plan am I on?", "What's my internet speed plan?", "Do I have a discount?"],
    dataShared: ["Plan name", "Discount percent"],
  },
  {
    intent: "AUTOPAY_STATUS",
    label: "Autopay Status",
    description: "Whether autopay is on or off.",
    examples: ["Is autopay on?", "Am I enrolled in automatic payments?", "Do I have autopay?"],
    dataShared: ["Autopay on/off"],
  },
  {
    intent: "TECH_TRIAGE",
    label: "Tech Triage",
    description: "Scripted basic troubleshooting (power-cycle modem/router, check cables), then offer a technician.",
    examples: ["My internet is down", "The Wi-Fi keeps dropping", "My connection is really slow"],
    dataShared: [],
  },
  {
    intent: "UNKNOWN",
    label: "Unknown",
    description: "Couldn't classify the request — the AI asks the caller to clarify rather than guessing.",
    examples: ["Hi, um, I have a question", "Can you help me?"],
    dataShared: [],
  },
];
