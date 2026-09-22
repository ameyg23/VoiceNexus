// Rule-based slot extraction. This is a deliberate placeholder for Thursday's
// Claude-based extraction (ARCHITECTURE.md roadmap step 2 vs 3) — regex only, no AI.
// The server still independently validates whatever is extracted against the DB;
// swapping this for Claude tomorrow won't change that contract.

export function extractBan(text: string): string | null {
  const explicit = text.match(/BAN\s*-?\s*(\d{6})/i);
  if (explicit) return `BAN${explicit[1]}`;

  const bareDigits = text.match(/\b(\d{6})\b/);
  if (bareDigits) return `BAN${bareDigits[1]}`;

  return null;
}

export function extractPin(text: string): string | null {
  const match = text.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
}

export function extractOtp(text: string): string | null {
  const match = text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}
