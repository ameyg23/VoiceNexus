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

import type { Intent } from "@voice-nexus/shared";

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

const INTENTS: Intent[] = [
  "CHECK_BALANCE",
  "MAKE_PAYMENT",
  "PAYMENT_HISTORY",
  "BILLING_DUE_DATE",
  "PLAN_INFO",
  "AUTOPAY_STATUS",
  "TECH_TRIAGE",
  "UNKNOWN",
];

// Returns null only when the AI itself is unavailable (so extraction.ts can fall back to keywords);
// a confident "can't tell" comes back as UNKNOWN.
export async function classifyIntentAI(utterance: string): Promise<Intent | null> {
  const result = await callGemini(
    `You classify a telecom customer support caller's utterance into exactly one intent from this ` +
      `fixed list: ${INTENTS.join(", ")}.\n` +
      `- CHECK_BALANCE: asking what they currently owe.\n` +
      `- MAKE_PAYMENT: wants to pay their bill now.\n` +
      `- PAYMENT_HISTORY: asking about a past payment.\n` +
      `- BILLING_DUE_DATE: asking when their next bill is due.\n` +
      `- PLAN_INFO: asking about their plan, discount, or pricing.\n` +
      `- AUTOPAY_STATUS: asking whether autopay is on/off.\n` +
      `- TECH_TRIAGE: reporting a technical problem (no internet, slow service, outage, etc).\n` +
      `- UNKNOWN: anything else, small talk, or unclear.\n` +
      `Return exactly one of these strings, nothing else.`,
    utterance,
    { type: "object", properties: { intent: { type: "string", enum: INTENTS } }, required: ["intent"] }
  );

  if (!result) return null;
  const intent = result.intent as Intent | undefined;
  return intent && INTENTS.includes(intent) ? intent : "UNKNOWN";
}

// --- Response phrasing (NLG only — the caller decides WHAT data is authorized to share; this only
// decides HOW to say it) ---

export async function phraseResponseAI(instruction: string, data: unknown): Promise<string | null> {
  const result = await callGemini(
    `You are the voice of a phone support agent, speaking a short reply out loud to a caller. ` +
      `You will be given an instruction describing what to convey, and a JSON object of data that has ` +
      `already been cleared for you to share. Phrase a natural, warm, concise spoken-style reply ` +
      `(1-2 sentences). Use ONLY the numbers/values present in the data — never invent or estimate a ` +
      `number that isn't there. Never mention JSON, field names, or that you were given data. If a data ` +
      `value is null or missing, do not mention that field at all.`,
    `Instruction: ${instruction}\nData: ${JSON.stringify(data)}`,
    { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  );

  return typeof result?.text === "string" && result.text.trim() ? result.text.trim() : null;
}
