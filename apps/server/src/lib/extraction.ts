// Slot extraction: Gemini-based (Thursday — ARCHITECTURE.md roadmap step 3), falling back to the
// original regex placeholder if the AI call is unavailable or returns nothing (missing API key,
// network error, ambiguous utterance). The server still independently validates whatever is
// extracted against the DB either way — swapping extraction strategy never changes that contract.

import { extractBanAI, extractPinAI, extractOtpAI } from "./aiEngine.js";

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

function extractBanRegex(text: string): string | null {
  const explicit = text.match(/BAN\s*-?\s*(\d{6})/i);
  if (explicit) return `BAN${explicit[1]}`;

  const bareDigits = text.match(/\b(\d{6})\b/);
  if (bareDigits) return `BAN${bareDigits[1]}`;

  return null;
}

function extractPinRegex(text: string): string | null {
  const match = text.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

function extractOtpRegex(text: string): string | null {
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}
