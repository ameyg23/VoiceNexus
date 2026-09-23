// Slot extraction: Gemini-based (Thursday — ARCHITECTURE.md roadmap step 3), falling back to the
// original regex placeholder if the AI call is unavailable or returns nothing (missing API key,
// network error, ambiguous utterance). The server still independently validates whatever is
// extracted against the DB either way — swapping extraction strategy never changes that contract.

import type { Intent } from "@voice-nexus/shared";
import { extractBanAI, extractPinAI, extractOtpAI, classifyIntentAI, classifyYesNoAI, extractDateAI, extractPlanAI } from "./aiEngine.js";
import { parseSpokenDate, toIsoDate, todayLocal } from "./dates.js";
import { PLAN_CATALOG, findPlan, matchPlanFromText, type PlanInfo } from "./businessLogic.js";

export async function extractBan(text: string): Promise<string | null> {
  const ai = await extractBanAI(text);
  return ai ?? extractBanRegex(text);
}

export async function extractPin(text: string): Promise<string | null> {
  const ai = await extractPinAI(text);
  return ai ?? extractPinRegex(text);
}

export async function extractOtp(text: string): Promise<string | null> {
  const ai = await extractOtpAI(text);
  return ai ?? extractOtpRegex(text);
}

// Phone speech-to-text often spaces or hyphenates digits read one at a time ("1 0 0 0 0 2",
// "4-8-2-1"); join runs of single digits so the patterns below see one number.
function joinSpokenDigits(text: string): string {
  return text.replace(/\b\d(?:[\s-]+\d\b)+/g, (run) => run.replace(/[\s-]+/g, ""));
}

// Intent: menu digit first (the IVR fallback menu, PRD NFR "degraded mode retains IVR menu
// fallback"), then AI, then keywords when the AI is unavailable (e.g. a free-tier 429) — so a
// caller is still served during an AI outage instead of looping on "could you clarify".
export const MENU: { digit: string; intent: Intent; label: string }[] = [
  { digit: "1", intent: "CHECK_BALANCE", label: "your balance" },
  { digit: "2", intent: "MAKE_PAYMENT", label: "to make a payment" },
  { digit: "3", intent: "BILLING_DUE_DATE", label: "your bill due date" },
  { digit: "4", intent: "PLAN_CHANGE", label: "plan options" },
  { digit: "5", intent: "TECH_TRIAGE", label: "internet or TV problems" },
  { digit: "6", intent: "PAYMENT_PROMISE", label: "a payment arrangement" },
  { digit: "7", intent: "SCHEDULE_CALLBACK", label: "a callback" },
  { digit: "0", intent: "AGENT_REQUEST", label: "an agent" },
];

export function menuPrompt(): string {
  return `You can press or say ${MENU.map((m) => `${m.digit} for ${m.label}`).join(", ")}.`;
}

const DIGIT_WORDS: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7" };

function menuIntent(text: string): Intent | null {
  const m = text.trim().toLowerCase().match(/^(?:press(?:ing)?\s+|option\s+|number\s+)?([0-7]|zero|one|two|three|four|five|six|seven)[.!]?$/);
  if (!m) return null;
  const digit = DIGIT_WORDS[m[1]] ?? m[1];
  return MENU.find((x) => x.digit === digit)?.intent ?? null;
}

export async function classifyIntent(text: string, examples: Partial<Record<Intent, string[]>> = {}): Promise<Intent> {
  return menuIntent(text) ?? (await classifyIntentAI(text, examples)) ?? classifyIntentKeywords(text);
}

// Checked in order — more specific intents first ("can't pay my bill" is a promise, not a payment).
const INTENT_KEYWORDS: [Intent, RegExp][] = [
  ["AGENT_REQUEST", /\b(agent|representative|human|real person|live person|operator|customer service rep)\b|speak (to|with) (a |an )?(person|someone)/i],
  ["SCHEDULE_CALLBACK", /\bcall(ing)? me back\b|\bcall ?back\b|\bring me back\b/i],
  ["SCHEDULE_TECH", /\btechnician\b|\btech (visit|to come)\b|send (someone|a tech)|someone (to )?come out|\bappointment\b/i],
  ["OUTAGE_CHECK", /\boutage\b|down in (my|the) area|is (the|your) (network|service) down/i],
  ["PAYMENT_PROMISE", /payment (arrangement|plan|extension)|\bpay (it )?later\b|can'?t pay|cannot pay|\bextension\b|promise to pay|more time to pay|pay (on|by) (the|friday|monday|next)/i],
  ["AUTOPAY_STATUS", /\bauto ?pay|automatic payment/i],
  ["PLAN_CHANGE", /\b(upgrade|downgrade|switch|change)\b.*\b(plan|package|speed|service)\b|\b(upgrade|downgrade)\b|other plans|different plan|faster (plan|internet)|what plans/i],
  ["MAKE_PAYMENT", /\b(make|pay) (a |my )?(payment|bill)|\bpay (it|off|now)|want to pay/i],
  ["PAYMENT_HISTORY", /\blast payment|payment (history|go through)|did (my|the) payment|when did i (last )?pay/i],
  ["BILLING_DUE_DATE", /\bdue date|\bwhen is (my|the) (bill|payment)|\bdue\b|next bill/i],
  ["TECH_TRIAGE", /\binternet|wi-?fi|\bmodem|router|\bslow\b|not working|connection|\bdown\b|\btv\b.*(not|isn'?t|won'?t)/i],
  ["PLAN_INFO", /\bplan\b|discount|speed|package/i],
  ["CHECK_BALANCE", /\bbalance|\bowe\b|how much|amount/i],
];

function classifyIntentKeywords(text: string): Intent {
  return INTENT_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "UNKNOWN";
}

// --- Subflow answers ---

const YES_RE = /^\s*(yes|yeah|yea|yep|yup|sure|ok(ay)?|correct|right|please( do)?|go ahead|do it|confirm(ed)?|absolutely|definitely|that'?s (right|correct|fine)|that works|sounds good|perfect|1)\b/i;
const NO_RE = /\b(no|nope|nah|don'?t|do not|cancel|stop|never ?mind|not (now|right now|today)|wrong|incorrect|hold off|2)\b/i;

export async function parseYesNo(text: string, question: string): Promise<"YES" | "NO" | null> {
  const yes = YES_RE.test(text);
  const no = NO_RE.test(text);
  if (yes && !no) return "YES";
  if (no && !yes) return "NO";
  return classifyYesNoAI(text, question);
}

export function isCancel(text: string): boolean {
  return /\b(cancel|never ?mind|forget it|stop|go back|something else)\b/i.test(text);
}

export async function extractDate(text: string): Promise<string | null> {
  return parseSpokenDate(text) ?? (await extractDateAI(text, toIsoDate(todayLocal())));
}

export async function extractPlan(text: string): Promise<PlanInfo | null> {
  const direct = matchPlanFromText(text);
  if (direct) return direct;
  const name = await extractPlanAI(text, PLAN_CATALOG.map((p) => p.name));
  return name ? (findPlan(name) ?? null) : null;
}

export function extractRating(text: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const m = text.toLowerCase().match(/\b([1-5]|one|two|three|four|five)\b/);
  return m ? (words[m[1]] ?? Number(m[1])) : null;
}

function extractBanRegex(raw: string): string | null {
  const text = joinSpokenDigits(raw);
  const explicit = text.match(/BAN\s*-?\s*(\d{6})/i);
  if (explicit) return `BAN${explicit[1]}`;

  const bareDigits = text.match(/\b(\d{6})\b/);
  if (bareDigits) return `BAN${bareDigits[1]}`;

  return null;
}

function extractPinRegex(raw: string): string | null {
  const text = joinSpokenDigits(raw);
  const match = text.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

function extractOtpRegex(raw: string): string | null {
  const text = joinSpokenDigits(raw);
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}
