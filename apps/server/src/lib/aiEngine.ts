// Google Gemini integration (ARCHITECTURE.md §2, switched from Claude — CLAUDE.md "Key decisions").
// The AI's job is language in/out ONLY: slot extraction, intent classification, response phrasing.
// It never decides authentication or which data is authorized to share — callers of this module
// (authStateMachine.ts) independently validate every extraction against the DB, and only ever
// pass this module data that's already been cleared to speak (ARCHITECTURE.md §1/§11/§17).
//
// Uses plain fetch against the Gemini REST API (no SDK dependency) since Node 24 has global fetch.
// Every function degrades to `null` on any failure (missing key, network error, bad JSON, timeout)
// so callers can fall back to deterministic behavior rather than guessing — same guardrail the
// regex placeholder followed (ARCHITECTURE.md §11 "never fabricate an answer").

import { ALL_INTENTS, type Intent } from "@voice-nexus/shared";

// "-lite" tier has a materially higher free-tier requests/minute quota than the "-latest"
// flash alias (which resolves to the newest full flash model, capped at 5 req/min free —
// too low for a multi-turn phone call). Discovered Thu while load-testing (CLAUDE.md note).
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const CALL_TIMEOUT_MS = 10000;

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(systemInstruction: string, userText: string, responseSchema: object): Promise<any | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[gemini] GEMINI_API_KEY not set — skipping AI call, caller will use fallback");
    return null;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema,
          },
        }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });

      if (!res.ok) {
        const retryable = res.status === 429 || res.status === 503;
        console.error(`[gemini] HTTP ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}): ${await res.text()}`);
        if (retryable && attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return null;
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      return JSON.parse(text);
    } catch (err) {
      console.error(`[gemini] call failed (attempt ${attempt}/${MAX_ATTEMPTS}):`, err instanceof Error ? err.message : err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return null;
    }
  }

  return null;
}

// --- Slot extraction (stage-scoped — each call only knows about the one slot it's after) ---

export async function extractBanAI(utterance: string): Promise<string | null> {
  const result = await callGemini(
    `You extract a customer account number (BAN) from a caller's spoken utterance in a phone support call. ` +
      `A BAN is always exactly 6 digits. Callers may say it plainly ("100002"), digit-by-digit ` +
      `("one zero zero zero zero two"), or prefixed ("my account number is BAN100002", "it's B A N 100002"). ` +
      `Return ONLY the 6 digits, with no "BAN" prefix and no spaces. If the utterance contains no ` +
      `6-digit-account-number-like value, return null. Do not guess or pad a shorter number.`,
    utterance,
    { type: "object", properties: { ban: { type: "string", nullable: true } }, required: ["ban"] }
  );

  const digits = result?.ban ? String(result.ban).replace(/\D/g, "") : null;
  return digits && digits.length === 6 ? `BAN${digits}` : null;
}

export async function extractPinAI(utterance: string): Promise<string | null> {
  const result = await callGemini(
    `You extract a 4-digit account PIN from a caller's spoken utterance in a phone support call. ` +
      `Callers may say it plainly ("4821") or digit-by-digit ("four eight two one"). Return ONLY the ` +
      `4 digits with no spaces. If no 4-digit-PIN-like value is present, return null.`,
    utterance,
    { type: "object", properties: { pin: { type: "string", nullable: true } }, required: ["pin"] }
  );

  const digits = result?.pin ? String(result.pin).replace(/\D/g, "") : null;
  return digits && digits.length === 4 ? digits : null;
}

export async function extractOtpAI(utterance: string): Promise<string | null> {
  const result = await callGemini(
    `You extract a 6-digit one-time passcode (OTP) from a caller's spoken utterance in a phone support ` +
      `call. Callers may say it plainly ("482013") or digit-by-digit. Return ONLY the 6 digits with no ` +
      `spaces. If no 6-digit-code-like value is present, return null.`,
    utterance,
    { type: "object", properties: { code: { type: "string", nullable: true } }, required: ["code"] }
  );

  const digits = result?.code ? String(result.code).replace(/\D/g, "") : null;
  return digits && digits.length === 6 ? digits : null;
}

// --- Intent classification ---

const INTENT_DESCRIPTIONS: Record<Intent, string> = {
  CHECK_BALANCE: "asking what they currently owe / their balance",
  MAKE_PAYMENT: "wants to pay their bill now",
  PAYMENT_HISTORY: "asking about a past payment or whether a payment went through",
  BILLING_DUE_DATE: "asking when their next bill is due",
  PAYMENT_PROMISE: "can't pay now and wants to arrange to pay later / by a certain date (payment arrangement, extension)",
  PLAN_INFO: "asking what plan they're on, its speed, price or discount",
  PLAN_CHANGE: "wants to upgrade, downgrade, switch or change their plan, or asks what other plans exist",
  AUTOPAY_STATUS: "asking whether autopay / automatic payments are on",
  OUTAGE_CHECK: "asking whether there's a service outage in their area",
  TECH_TRIAGE: "reporting a technical problem (no internet, slow, Wi-Fi dropping, TV not working)",
  SCHEDULE_TECH: "explicitly wants a technician visit / someone to come out",
  SCHEDULE_CALLBACK: "wants someone to call them back later",
  AGENT_REQUEST: "wants to speak to a human / live agent / representative",
  UNKNOWN: "anything else, small talk, or unclear",
};

// Returns null only when the AI itself is unavailable (so extraction.ts can fall back to keywords);
// a confident "can't tell" comes back as UNKNOWN. Operator-curated example utterances (tenant settings)
// are included as hints.
export async function classifyIntentAI(utterance: string, examples: Partial<Record<Intent, string[]>> = {}): Promise<Intent | null> {
  const lines = ALL_INTENTS.map((i) => {
    const ex = examples[i]?.length ? ` Examples: ${examples[i]!.map((e) => `"${e}"`).join(", ")}.` : "";
    return `- ${i}: ${INTENT_DESCRIPTIONS[i]}.${ex}`;
  });
  const result = await callGemini(
    `You classify a telecom customer support caller's utterance into exactly one intent from this ` +
      `fixed list:\n${lines.join("\n")}\nReturn exactly one of these strings, nothing else.`,
    utterance,
    { type: "object", properties: { intent: { type: "string", enum: [...ALL_INTENTS] } }, required: ["intent"] }
  );

  if (!result) return null;
  const intent = result.intent as Intent | undefined;
  return intent && ALL_INTENTS.includes(intent) ? intent : "UNKNOWN";
}

// --- Subflow slot extraction ---

export async function classifyYesNoAI(utterance: string, question: string): Promise<"YES" | "NO" | null> {
  const result = await callGemini(
    `A phone caller was asked a yes/no question. Decide whether their reply means YES, NO, or is UNCLEAR ` +
      `(e.g. they asked something else, or hedged). Only answer YES when the caller clearly agrees.`,
    `Question: ${question}\nCaller's reply: ${utterance}`,
    { type: "object", properties: { answer: { type: "string", enum: ["YES", "NO", "UNCLEAR"] } }, required: ["answer"] }
  );
  return result?.answer === "YES" || result?.answer === "NO" ? result.answer : null;
}

export async function extractDateAI(utterance: string, todayIso: string): Promise<string | null> {
  const result = await callGemini(
    `Today is ${todayIso}. Extract the calendar date the caller means from their spoken reply, resolving ` +
      `relative expressions ("next Tuesday", "end of the month", "the 3rd") against today. Return it as ` +
      `YYYY-MM-DD, or null if they didn't name a date. Never guess a date they didn't express.`,
    utterance,
    { type: "object", properties: { date: { type: "string", nullable: true } }, required: ["date"] }
  );
  const date = typeof result?.date === "string" ? result.date.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export async function extractPlanAI(utterance: string, planNames: string[]): Promise<string | null> {
  const result = await callGemini(
    `A caller is choosing a new service plan. Which ONE of these plans did they ask for: ` +
      `${planNames.map((p) => `"${p}"`).join(", ")}? Return the exact plan name, or null if they didn't ` +
      `clearly pick one.`,
    utterance,
    { type: "object", properties: { plan: { type: "string", nullable: true, enum: [...planNames] } }, required: ["plan"] }
  );
  return typeof result?.plan === "string" && planNames.includes(result.plan) ? result.plan : null;
}

// --- Response phrasing (NLG only — the caller decides WHAT data is authorized to share; this only
// decides HOW to say it) ---

export interface VoiceStyle {
  brandName: string;
  assistantName: string;
  tone: string; // operator brand voice (tenant settings)
  languageName: string; // e.g. "English", "Spanish"
}

export async function phraseResponseAI(instruction: string, data: unknown, style?: VoiceStyle): Promise<string | null> {
  const voice = style
    ? `You are ${style.assistantName}, the phone assistant for ${style.brandName}. Brand voice: ${style.tone}. Reply in ${style.languageName}. `
    : "";
  const result = await callGemini(
    voice +
      `You are the voice of a phone support agent, speaking a short reply out loud to a caller. ` +
      `You will be given an instruction describing what to convey, and a JSON object of data that has ` +
      `already been cleared for you to share. Phrase a natural, concise spoken-style reply ` +
      `(1-2 sentences). Use ONLY the numbers/values present in the data — never invent or estimate a ` +
      `number that isn't there. Never mention JSON, field names, or that you were given data. If a data ` +
      `value is null or missing, do not mention that field at all.`,
    `Instruction: ${instruction}
Data: ${JSON.stringify(data)}`,
    { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  );

  return typeof result?.text === "string" && result.text.trim() ? result.text.trim() : null;
}

// Language selection (VN-7): fixed prompts are written in English; for another tenant language they're
// translated at speak time. Numbers, dates, plan names and codes must survive unchanged. Returns null on
// any failure, and the caller then speaks the English original rather than nothing.
export async function translateAI(text: string, languageName: string): Promise<string | null> {
  const result = await callGemini(
    `Translate this phone assistant's spoken reply into natural, polite ${languageName}. Keep every number, ` +
      `amount, date, account number, plan name and brand name exactly as written. Output only the translation.`,
    text,
    { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  );
  return typeof result?.text === "string" && result.text.trim() ? result.text.trim() : null;
}
