// Human-readable catalog of the Intent enum (packages/shared), for the dashboard's Intents page. The
// set of intents and their fulfillment subflows are code-defined (authStateMachine.ts); operations
// curates them per tenant — enable/disable an intent and add example utterances for the classifier —
// via settings.intentOverrides (PRD §5 "configures intents, utterances").

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
    description: "Reads back the balance and asks for a yes before charging the card on file (simulated). Zeroes balance and past-due.",
    examples: ["I want to pay my bill", "Pay off my balance", "Can I make a payment?"],
    dataShared: ["Current balance", "Amount paid"],
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
    intent: "PAYMENT_PROMISE",
    label: "Payment Promise",
    description: "Sets up a promise to pay the balance by a date up to 14 days out, confirmed before it's logged.",
    examples: ["Can I pay next Friday?", "I need more time to pay", "I can't pay until the 30th"],
    dataShared: ["Current balance"],
  },
  {
    intent: "PLAN_INFO",
    label: "Plan Info",
    description: "Current plan name and any discount applied.",
    examples: ["What plan am I on?", "What's my internet speed plan?", "Do I have a discount?"],
    dataShared: ["Plan name", "Discount percent"],
  },
  {
    intent: "PLAN_CHANGE",
    label: "Plan Change",
    description: "Lists the other plans with prices, then switches plan after the caller confirms (effective next bill).",
    examples: ["I want to upgrade my internet", "Switch me to the 1 gig plan", "What other plans do you have?"],
    dataShared: ["Current plan", "Plan prices"],
  },
  {
    intent: "AUTOPAY_STATUS",
    label: "Autopay Status",
    description: "Whether autopay is on or off.",
    examples: ["Is autopay on?", "Am I enrolled in automatic payments?", "Do I have autopay?"],
    dataShared: ["Autopay on/off"],
  },
  {
    intent: "OUTAGE_CHECK",
    label: "Outage Check",
    description: "Checks for a known outage at the account's service ZIP and gives the restore estimate.",
    examples: ["Is there an outage?", "Is the internet down in my area?", "Is your service down?"],
    dataShared: ["Outage status for the service area"],
  },
  {
    intent: "TECH_TRIAGE",
    label: "Tech Triage",
    description: "Checks for an outage first, then scripted basic troubleshooting (power-cycle modem/router, check cables), then offers a technician visit.",
    examples: ["My internet is down", "The Wi-Fi keeps dropping", "My connection is really slow"],
    dataShared: [],
  },
  {
    intent: "SCHEDULE_TECH",
    label: "Technician Visit",
    description: "Books a technician for a day in the next week, morning or afternoon window, after confirmation (dispatch request).",
    examples: ["I need a technician", "Can someone come out?", "Book me an appointment"],
    dataShared: [],
  },
  {
    intent: "SCHEDULE_CALLBACK",
    label: "Callback",
    description: "Books a callback to the caller's number for a day and time window. Works before verification too.",
    examples: ["Can someone call me back?", "Call me back tomorrow", "I'd like a callback"],
    dataShared: [],
  },
  {
    intent: "SERVICE_AVAILABILITY",
    label: "Service Availability",
    description: "For callers who aren't yet a customer: asks residential or business, then a ZIP code, and checks whether Springfield Fiber serves that area. Offers to transfer to sign up if it does.",
    examples: ["Is service available in my area?", "Do you serve my address?", "I want to sign up for internet"],
    dataShared: [],
  },
  {
    intent: "AGENT_REQUEST",
    label: "Agent Request",
    description: "Transfers to a live agent with a structured handoff (identity status, intent, what was tried). Works at any point in the call.",
    examples: ["Let me talk to a person", "Representative", "I want a human"],
    dataShared: [],
  },
  {
    intent: "UNKNOWN",
    label: "Unknown",
    description: "Couldn't classify the request. The assistant says so and offers the menu. After repeated misses it offers a live agent or a callback instead of guessing.",
    examples: ["Hi, um, I have a question", "Can you help me?"],
    dataShared: [],
  },
];
