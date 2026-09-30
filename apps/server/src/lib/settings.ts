// Per-tenant settings (PRD VN-7 brand voice / language / pronunciation, VN-9 greeting / hold / close
// prompts, compliance disclosures, escalation rules, intent catalog curation, cost model). Defaults
// live here; operations overrides individual keys from the dashboard (tenant_settings rows).

import { z } from "zod";
import { db } from "@voice-nexus/db";
import type { Intent, Language } from "@voice-nexus/shared";

const pronunciationSchema = z.object({ from: z.string().trim().min(1).max(40), to: z.string().trim().min(1).max(80) });
const intentOverrideSchema = z.object({
  enabled: z.boolean(),
  // Extra operator-curated example utterances, fed to the classifier as hints.
  examples: z.array(z.string().trim().min(1).max(200)).max(20),
});

export const settingsSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  assistantName: z.string().trim().min(1).max(40),
  // Free-text brand voice given to the AI when it phrases replies, e.g. "warm, upbeat, concise".
  voiceTone: z.string().trim().min(1).max(200),
  language: z.enum(["en-US", "es-US", "hi-IN"]),
  // Twilio <Say> voice for the phone channel (Amazon Polly voices supported by Twilio).
  phoneVoice: z.string().trim().min(1).max(40),
  pronunciations: z.array(pronunciationSchema).max(50),
  // {brand}, {assistant} and {disclosures} are filled in. {disclosures} = the AI/recording notices below.
  greetingPrompt: z.string().trim().min(1).max(400),
  holdPrompt: z.string().trim().min(1).max(200),
  closePrompt: z.string().trim().min(1).max(200),
  aiDisclosureEnabled: z.boolean(),
  aiDisclosureText: z.string().trim().min(1).max(200),
  recordingEnabled: z.boolean(),
  recordingDisclosureEnabled: z.boolean(),
  recordingDisclosureText: z.string().trim().min(1).max(200),
  csatSurveyEnabled: z.boolean(),
  // Escalation rules (v1 is rule-based — PRD §13).
  escalateOnAgentRequest: z.boolean(),
  unknownTurnsBeforeEscalation: z.number().int().min(1).max(5),
  // E.164 number to <Dial> on a phone-channel transfer; blank = queue the handoff and end the call.
  agentTransferNumber: z.string().trim().max(20).regex(/^(\+\d{8,15})?$/, "use E.164, e.g. +15551234567"),
  // Spoken before every live-agent transfer, e.g. "I'm transferring you now. Your reference code is 3014."
  // No real routing happens (there's no live agent in this deployment) — this announces which queue a
  // real transfer would have gone to, for realism and for reporting.
  routingCodes: z.object({
    generalEnquiry: z.string().trim().min(1).max(12), // fallback when intent is unknown, or has no code of its own
    newCustomerResidential: z.string().trim().min(1).max(12),
    newCustomerBusiness: z.string().trim().min(1).max(12),
    // One code per topic (PRD-adjacent, user request): so a call transcript can show which queue a
    // caller's actual topic should have routed to, next to which code was actually spoken — lets ops
    // spot a misroute at a glance instead of every transfer landing in one generic bucket.
    byIntent: z.record(z.string(), z.string().trim().min(1).max(12)),
  }),
  intentOverrides: z.record(z.string(), intentOverrideSchema),
  // Cost model for the "cost per care call" report (PRD §10) — operator's own rates.
  costPerMinuteAutomated: z.number().min(0).max(100),
  costPerMinuteAgent: z.number().min(0).max(100),
  agentMinutesPerEscalation: z.number().min(0).max(120),
});

export type TenantSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: TenantSettings = {
  brandName: "Springfield Fiber",
  assistantName: "Ava",
  voiceTone: "warm, friendly, professional and concise",
  language: "en-US",
  phoneVoice: "Polly.Joanna",
  pronunciations: [
    { from: "BAN", to: "B-A-N" },
    { from: "OTP", to: "O-T-P" },
    { from: "Wi-Fi", to: "why-fye" },
  ],
  greetingPrompt: "Hi! Thanks for calling {brand}. {disclosures} What can I help you with today?",
  holdPrompt: "One moment while I look that up.",
  closePrompt: "Thanks for calling {brand}. Have a great day!",
  aiDisclosureEnabled: true,
  aiDisclosureText: "I'm {assistant}, {brand}'s automated virtual assistant.",
  recordingEnabled: true,
  recordingDisclosureEnabled: false,
  recordingDisclosureText: "This call may be recorded for quality and training.",
  csatSurveyEnabled: false,
  escalateOnAgentRequest: true,
  unknownTurnsBeforeEscalation: 2,
  agentTransferNumber: "",
  routingCodes: {
    generalEnquiry: "3014",
    newCustomerResidential: "3000",
    newCustomerBusiness: "3003",
    byIntent: {
      CHECK_BALANCE: "3020",
      MAKE_PAYMENT: "3021",
      PAYMENT_HISTORY: "3022",
      BILLING_DUE_DATE: "3023",
      PAYMENT_PROMISE: "3024",
      PLAN_INFO: "3025",
      PLAN_CHANGE: "3026",
      AUTOPAY_STATUS: "3027",
      OUTAGE_CHECK: "3028",
      TECH_TRIAGE: "3029",
      SCHEDULE_TECH: "3030",
      SCHEDULE_CALLBACK: "3031",
      SERVICE_AVAILABILITY: "3032",
      AGENT_REQUEST: "3033",
    },
  },
  intentOverrides: {},
  costPerMinuteAutomated: 0.05,
  costPerMinuteAgent: 1.0,
  agentMinutesPerEscalation: 6,
};

export function getSettings(): TenantSettings {
  const rows = db.prepare(`SELECT key, value FROM tenant_settings`).all() as { key: string; value: string }[];
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      merged[row.key] = JSON.parse(row.value);
    } catch {
      // Ignore a corrupt row rather than break every call — the default stands.
    }
  }
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function updateSettings(patch: Partial<TenantSettings>): TenantSettings {
  const next = settingsSchema.parse({ ...getSettings(), ...patch });
  const upsert = db.prepare(`
    INSERT INTO tenant_settings (key, value, updated_at) VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  db.exec("BEGIN");
  try {
    for (const key of Object.keys(patch) as (keyof TenantSettings)[]) {
      upsert.run({ "@key": key, "@value": JSON.stringify(next[key]) });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return next;
}

export function fillTemplate(text: string, s: TenantSettings = getSettings()): string {
  return text.replaceAll("{brand}", s.brandName).replaceAll("{assistant}", s.assistantName);
}

// Greeting = greetingPrompt with the enabled compliance notices dropped into {disclosures} (or put in
// front if the operator removed the placeholder), so disclosure can't silently disappear.
export function buildGreeting(s: TenantSettings = getSettings()): string {
  const notices = [
    s.aiDisclosureEnabled ? s.aiDisclosureText : null,
    s.recordingEnabled && s.recordingDisclosureEnabled ? s.recordingDisclosureText : null,
  ]
    .filter(Boolean)
    .join(" ");
  const prompt = s.greetingPrompt.includes("{disclosures}") ? s.greetingPrompt.replace("{disclosures}", notices) : `${notices} ${s.greetingPrompt}`;
  return fillTemplate(prompt, s).replace(/\s+/g, " ").trim();
}

// Pronunciation overrides, applied only to what's spoken (TTS) — the transcript keeps the real text.
export function toSpeech(text: string, s: TenantSettings = getSettings()): string {
  let out = text;
  for (const { from, to } of s.pronunciations) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "gi"), to);
  }
  return out;
}

export function isIntentEnabled(intent: Intent, s: TenantSettings = getSettings()): boolean {
  return s.intentOverrides[intent]?.enabled ?? true;
}

// The routing code a live-agent transfer should announce for a given caller intent — one shared
// lookup used both when a transfer actually happens (authStateMachine.ts) and when displaying what
// *should* have been used next to what actually was (operations.ts, Call Detail), so the two can
// never drift apart. Falls back to the general-enquiry code when the intent has no code of its own,
// or wasn't captured (caller never got far enough to state one).
export function routingCodeForIntent(s: TenantSettings, intent: Intent | string | null): string {
  return (intent && s.routingCodes.byIntent[intent]) || s.routingCodes.generalEnquiry;
}

export const LANGUAGE_NAMES: Record<Language, string> = {
  "en-US": "English",
  "es-US": "Spanish",
  "hi-IN": "Hindi",
};
