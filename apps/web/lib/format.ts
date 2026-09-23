import type { AuthMethod, CallOutcome, Intent } from "@voice-nexus/shared";
import type { BadgeTone } from "../components/Badge";
import type { EscalationReason } from "./api";

export const INTENT_LABELS: Record<Intent, string> = {
  CHECK_BALANCE: "Check Balance",
  MAKE_PAYMENT: "Make Payment",
  PAYMENT_HISTORY: "Payment History",
  BILLING_DUE_DATE: "Billing Due Date",
  PLAN_INFO: "Plan Info",
  AUTOPAY_STATUS: "Autopay Status",
  TECH_TRIAGE: "Tech Triage",
  UNKNOWN: "Unknown",
};

export function intentLabel(intent: Intent | null | undefined): string {
  return intent ? (INTENT_LABELS[intent] ?? intent) : "—";
}

export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  RESOLVED: "Resolved",
  ESCALATED: "Escalated",
  ABANDONED: "Abandoned",
  IN_PROGRESS: "In progress",
};

export const OUTCOME_TONES: Record<CallOutcome, BadgeTone> = {
  RESOLVED: "success",
  ESCALATED: "danger",
  ABANDONED: "warning",
  IN_PROGRESS: "info",
};

export const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
  PIN: "PIN",
  EMAIL_OTP: "Email OTP",
  SMS_OTP: "SMS OTP",
};

export const MFA_LABELS: Record<"NONE" | "EMAIL" | "SMS", string> = {
  NONE: "PIN only",
  EMAIL: "Email OTP",
  SMS: "SMS OTP",
};

export const ESCALATION_REASON_LABELS: Record<EscalationReason, string> = {
  PIN_LOCKOUT: "PIN lockout (3 wrong PINs)",
  OTP_FAILED: "OTP attempts exhausted",
  VERIFICATION_FAILED: "Verification failed",
};

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}
