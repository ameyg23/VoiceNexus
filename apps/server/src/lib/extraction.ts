// Slot extraction: Gemini-based (Thursday — ARCHITECTURE.md roadmap step 3), falling back to the
// original regex placeholder if the AI call is unavailable or returns nothing (missing API key,
// network error, ambiguous utterance). The server still independently validates whatever is
// extracted against the DB either way — swapping extraction strategy never changes that contract.

import type { Intent } from "@voice-nexus/shared";
import { extractBanAI, extractPinAI, extractOtpAI, classifyIntentAI } from "./aiEngine.js";

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

// Intent: same AI-first pattern. The keyword fallback only runs when Gemini is unavailable (e.g. a
// free-tier 429), so a verified caller still gets served during an AI outage instead of looping on
// "could you clarify". Order matters — more specific intents are checked first.
export async function classifyIntent(text: string): Promise<Intent> {
  return (await classifyIntentAI(text)) ?? classifyIntentKeywords(text);
}

const INTENT_KEYWORDS: [Intent, RegExp][] = [
  ["AUTOPAY_STATUS", /\bauto ?pay|automatic payment/i],
  ["MAKE_PAYMENT", /\b(make|pay) (a |my )?(payment|bill)|\bpay (it|off|now)|want to pay/i],
  ["PAYMENT_HISTORY", /\blast payment|payment (history|go through)|did (my|the) payment|when did i (last )?pay/i],
  ["BILLING_DUE_DATE", /\bdue date|\bwhen is (my|the) (bill|payment)|\bdue\b|next bill/i],
  ["TECH_TRIAGE", /\binternet|wi-?fi|\bmodem|router|outage|\bslow\b|not working|connection|down\b/i],
  ["PLAN_INFO", /\bplan\b|discount|speed|package/i],
  ["CHECK_BALANCE", /\bbalance|\bowe\b|how much|amount/i],
];

function classifyIntentKeywords(text: string): Intent {
  return INTENT_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "UNKNOWN";
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
