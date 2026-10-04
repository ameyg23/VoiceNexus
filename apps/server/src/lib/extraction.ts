// Slot extraction. For BAN / PIN / OTP the deterministic parser runs first — digits said or keyed
// plainly ("100001", "4 8 2 1") need no AI round-trip, which keeps those turns fast — and Gemini
// handles the rest (number words, filler, "B as in boy"). The server still independently validates
// whatever is extracted against the DB either way — the extraction strategy never changes that.

import type { CustomerType, Intent } from "@voice-nexus/shared";
import {
  extractBanAI,
  extractPinAI,
  extractOtpAI,
  classifyIntentAI,
  classifyYesNoAI,
  classifyForgotCredentialsAI,
  classifyPlanQuestionAI,
  extractDateAI,
  extractPlanAI,
} from "./aiEngine.js";
import { parseSpokenDate, toIsoDate, todayLocal } from "./dates.js";
import { PLAN_CATALOG, findPlan, matchPlanFromText, type PlanInfo } from "./businessLogic.js";

export interface Extracted {
  value: string;
  // Regex-matched (plain digits, typed keypad, or clean "one zero zero..." runs) — unambiguous, so
  // the caller doesn't need to hear it read back. false = the AI had to interpret it (filler, unusual
  // phrasing) — confirm it before using it (PRD "confirm only if unclear").
  confident: boolean;
}

export async function extractBan(text: string): Promise<Extracted | null> {
  const regex = extractBanRegex(text);
  if (regex) return { value: regex, confident: true };
  const ai = await extractBanAI(text);
  return ai ? { value: ai, confident: false } : null;
}

export async function extractPin(text: string): Promise<Extracted | null> {
  const regex = extractPinRegex(text);
  if (regex) return { value: regex, confident: true };
  const ai = await extractPinAI(text);
  return ai ? { value: ai, confident: false } : null;
}

// 6-digit ZIP/PIN code (user request, Oct 4 — matches the 6-digit postal code format the caller
// actually expects, not the US 5-digit ZIP this was originally written against) — plain digits or a
// keypad entry are unambiguous enough that no AI fallback is needed.
export function extractZip(raw: string): string | null {
  const text = joinSpokenDigits(raw);
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}


const EXISTING_CUSTOMER_RE = /\b(existing|current|already (a |an )?customer|have (an )?account|i'?m a customer)\b/i;
const NEW_CUSTOMER_RE = /\bnew( customer)?\b|not (a )?customer (yet)?|don'?t have an account|sign(ing)? up|i'?d like to (become|sign up)/i;

export function parseCustomerKind(text: string): "EXISTING" | "NEW" | null {
  const existing = EXISTING_CUSTOMER_RE.test(text);
  const isNew = NEW_CUSTOMER_RE.test(text);
  if (existing && !isNew) return "EXISTING";
  if (isNew && !existing) return "NEW";
  return null;
}

const BUSINESS_RE = /\bbusiness\b|\bcompany\b|\bcommercial\b/i;
const RESIDENTIAL_RE = /\bresidential\b|\bresidence\b|\bhome\b|\bpersonal\b|\bhousehold\b/i;

export function parseAccountType(text: string): "RESIDENTIAL" | "BUSINESS" | null {
  const business = BUSINESS_RE.test(text);
  const residential = RESIDENTIAL_RE.test(text);
  if (business && !residential) return "BUSINESS";
  if (residential && !business) return "RESIDENTIAL";
  return null;
}

// "Wrong account, let me give you a different one" mid-call, after already being verified.
export const SWITCH_ACCOUNT_RE =
  /\b(wrong|different|another|other) account\b|\bswitch(ing)? accounts?\b|\bnot the (right|correct) account\b|\bmy other account\b/i;

// A caller who genuinely can't produce their account number or PIN. The regex only covers the most
// common phrasings ("I don't remember", "I forgot") and costs nothing when it matches; anything else
// goes to the AI, which judges the meaning rather than matching words - callers don't all say this the
// same way ("it's not coming to mind", "my partner set that up, I never knew it"), and the whole point
// of this check is to actually understand them instead of guessing from a keyword list.
const FORGOT_CREDENTIALS_RE =
  /\b(don'?t|do not|dont|can'?t|cannot|no longer) (remember|recall|know|have)\b|\bforgot(ten)?\b|\blost (it|that|my (account number|pin|password))\b/i;

export async function isForgotCredentials(text: string): Promise<boolean> {
  if (FORGOT_CREDENTIALS_RE.test(text)) return true;
  return (await classifyForgotCredentialsAI(text)) === true;
}

// AI fallback for the regex-based PLANS_OR_SERVICES_RE/PLAN_RECOMMEND_RE checks in authStateMachine.ts -
// real speech varies more than either regex can match (found live, Oct 4: "tell me uh, the residential
// plans that you have" and "what is the best residential plan to buy" both failed, since the regexes need
// "plans" or "plan" immediately adjacent to specific words, with no filler or adjective in between). Gated
// behind a cheap keyword pre-filter so this never adds a round-trip to a turn that obviously isn't about
// plans at all (digit entry, yes/no, etc.) - same cost-bounding idea as isForgotCredentials above.
const MENTIONS_PLAN_RE = /\b(plans?|packages?|services?)\b/i;

export async function classifyPlanQuestion(text: string): Promise<"CATALOG" | "RECOMMEND" | null> {
  if (!MENTIONS_PLAN_RE.test(text)) return null;
  const kind = await classifyPlanQuestionAI(text);
  return kind === "CATALOG" || kind === "RECOMMEND" ? kind : null;
}

export async function extractOtp(text: string): Promise<string | null> {
  return extractOtpRegex(text) ?? (await extractOtpAI(text));
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
  { digit: "2", intent: "MAKE_PAYMENT", label: "a payment" },
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
  ["AGENT_REQUEST", /\b(agent|representative|human|real person|live person|operator|customer service rep|customer support)\b|speak (to|with) (a |an )?(person|someone)/i],
  [
    "SERVICE_AVAILABILITY",
    /\bservice available\b|\bavailable (in|for|at) (my|your|this) area\b|\bdo you (cover|serve)\b|\baddress covered\b|\bservice area\b|\bsign(ing)? up\b|\bbecome a (new )?customer\b|\bnew customer\b/i,
  ],
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

export async function extractPlan(text: string, audience: CustomerType = "RESIDENTIAL"): Promise<PlanInfo | null> {
  const direct = matchPlanFromText(text, audience);
  if (direct) return direct;
  const candidates = PLAN_CATALOG.filter((p) => p.audience === audience);
  const name = await extractPlanAI(text, candidates.map((p) => p.name));
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
