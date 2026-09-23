// Deterministic date / time-window parsing for scheduling subflows (payment promise, technician visit,
// callback). Handles the common spoken forms; anything else falls through to the AI (aiEngine
// extractDateAI) and, failing that, a re-prompt — never a guessed date.

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty first": 21, "twenty second": 22, "twenty third": 23,
  "twenty fourth": 24, "twenty fifth": 25, "twenty sixth": 26, "twenty seventh": 27, "twenty eighth": 28,
  "twenty ninth": 29, thirtieth: 30, "thirty first": 31,
};

export type TimeWindow = "MORNING" | "AFTERNOON" | "EVENING";
export const WINDOW_LABELS: Record<TimeWindow, string> = {
  MORNING: "morning (8 AM to 12 PM)",
  AFTERNOON: "afternoon (12 to 5 PM)",
  EVENING: "evening (5 to 8 PM)",
};

export function todayLocal(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function speakDate(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// Returns an ISO date (YYYY-MM-DD) or null. Relative forms resolve against `today`; a bare day of the
// month ("the 30th") means the next occurrence.
export function parseSpokenDate(text: string, today: Date = todayLocal()): string | null {
  const t = text.toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ");

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b|\bas soon as possible\b|\basap\b|\bright away\b|\bnow\b/.test(t)) return toIsoDate(today);
  if (/\bday after tomorrow\b/.test(t)) return toIsoDate(addDays(today, 2));
  if (/\btomorrow\b/.test(t)) return toIsoDate(addDays(today, 1));

  const inDays = t.match(/\bin (\d+|a|one|two|three|four|five|six|seven) (day|days|week)\b/);
  if (inDays) {
    const words: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const n = /^\d+$/.test(inDays[1]) ? Number(inDays[1]) : words[inDays[1]];
    return toIsoDate(addDays(today, inDays[2] === "week" ? 7 * n : n));
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    // "next Friday" is ambiguous in speech, so it's treated like "Friday" (the coming one); the
    // subflow always reads the resolved date back for confirmation.
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      let delta = (i - today.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "Monday" said on a Monday means next week's
      return toIsoDate(addDays(today, delta));
    }
  }

  // "September 30" / "30 September" / "sept 30th"
  for (let mi = 0; mi < MONTHS.length; mi++) {
    const name = MONTHS[mi];
    const short = name.slice(0, 3);
    const m =
      t.match(new RegExp(`\\b(?:${name}|${short}\\w*)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)) ??
      t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${name}|${short}\\w*)\\b`));
    if (m) return nextOccurrence(mi, Number(m[1]), today);
  }

  // "9/30"
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) return nextOccurrence(Number(slash[1]) - 1, Number(slash[2]), today);

  // "the 30th" / "on the thirtieth"
  const ordinal = t.match(/\b(?:the )?(\d{1,2})(?:st|nd|rd|th)\b/);
  const ordinalWord = Object.keys(ORDINAL_WORDS)
    .sort((a, b) => b.length - a.length)
    .find((w) => new RegExp(`\\b(?:the )?${w}\\b`).test(t));
  const day = ordinal ? Number(ordinal[1]) : ordinalWord ? ORDINAL_WORDS[ordinalWord] : null;
  if (day && day >= 1 && day <= 31) {
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
    if (thisMonth.getMonth() === today.getMonth() && thisMonth >= today) return toIsoDate(thisMonth);
    const next = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return next.getDate() === day ? toIsoDate(next) : null;
  }

  return null;
}

function nextOccurrence(monthIndex: number, day: number, today: Date): string | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  let d = new Date(today.getFullYear(), monthIndex, day);
  if (d.getMonth() !== monthIndex) return null;
  if (d < today) d = new Date(today.getFullYear() + 1, monthIndex, day);
  return toIsoDate(d);
}

export function parseWindow(text: string): TimeWindow | null {
  const t = text.toLowerCase();
  if (/\bmorning\b|\bbefore (noon|lunch)\b|\b(8|9|10|11)\s*(am|a\.m\.)/.test(t)) return "MORNING";
  if (/\bafternoon\b|\bafter (lunch|noon)\b|\b(12|1|2|3|4)\s*(pm|p\.m\.)/.test(t)) return "AFTERNOON";
  if (/\bevening\b|\btonight\b|\bafter work\b|\b(5|6|7)\s*(pm|p\.m\.)/.test(t)) return "EVENING";
  return null;
}
