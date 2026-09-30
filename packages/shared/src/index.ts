// Shared types — mirrors packages/db schema (ARCHITECTURE.md §4-9).
// Server is the source of truth for validation; these are for compile-time safety only.

export type MfaMethod = "NONE" | "EMAIL" | "SMS";
export type CustomerType = "RESIDENTIAL" | "BUSINESS";

export interface Customer {
  id: string; // e.g. CUS001
  name: string;
  phoneNumber: string; // E.164; ANI source, never used for auth
  ban: string; // e.g. BAN100001
  pinHash: string; // bcrypt, never sent to frontend
  email: string;
  mfaEnabled: boolean;
  mfaMethod: MfaMethod;
  mfaPhoneNumber: string | null; // OTP-delivery phone once enrolled; distinct from phoneNumber (ANI)
  customerType: CustomerType;
  currentBalance: number;
  lastPaymentAmount: number;
  lastPaymentDate: string;
  nextBillingDueDate: string;
  pastDueAmount: number;
  discountPercent: number;
  autopayEnabled: boolean;
  planName: string;
  accountStatus: string;
  createdAt: string;
}

export type AuthStatus = "PENDING" | "SUCCESS" | "FAILED";
export type AuthMethod = "PIN" | "EMAIL_OTP" | "SMS_OTP";
export type ConversationStatus = "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
export type Channel = "DEMO" | "PHONE";
// Dashboard-facing outcome, derived server-side from auth_status + status (apps/server/src/lib/outcome.ts).
// CALLBACK = a follow-up call was booked instead of resolving in-flow (not contained, not transferred).
export type CallOutcome = "RESOLVED" | "ESCALATED" | "CALLBACK" | "ABANDONED" | "IN_PROGRESS";

export interface Conversation {
  id: string; // display code VN-000001
  customerId: string | null;
  ani: string;
  banProvided: string | null;
  authStatus: AuthStatus;
  authMethod: AuthMethod | null;
  detectedIntent: string | null;
  status: ConversationStatus;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  audioPath: string | null;
  createdAt: string;
}

export type Speaker = "AI" | "CUSTOMER";

export interface TranscriptTurn {
  id: number;
  conversationId: string;
  turnIndex: number;
  speaker: Speaker;
  text: string;
  timestamp: string;
}

export type AuthStage =
  | "AWAITING_INTENT"
  | "AWAITING_BAN"
  | "AWAITING_PIN"
  | "AWAITING_OTP"
  | "AUTHENTICATED"
  | "FAILED";

export interface AuthSession {
  conversationId: string;
  stage: AuthStage;
  customerId: string | null;
  pinAttempts: number;
  authenticatedAt: string | null;
}

export type OtpMethod = "EMAIL" | "SMS";
export type OtpStatus = "PENDING" | "VERIFIED" | "EXPIRED" | "FAILED";

export interface Otp {
  id: number;
  conversationId: string;
  customerId: string;
  codeHash: string;
  method: OtpMethod;
  destinationMasked: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  status: OtpStatus;
}

export type EmployeeRole = "ADMIN" | "AGENT" | "VIEWER";

export interface Employee {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  role: EmployeeRole;
}

// Intents recognized by the AI engine — the operator's top care intents (PRD VN-1/VN-4: billing,
// account, plan, payment promise, outage/tech triage, dispatch, scheduling, agent transfer).
export type Intent =
  | "CHECK_BALANCE"
  | "MAKE_PAYMENT"
  | "PAYMENT_HISTORY"
  | "BILLING_DUE_DATE"
  | "PAYMENT_PROMISE"
  | "PLAN_INFO"
  | "PLAN_CHANGE"
  | "AUTOPAY_STATUS"
  | "OUTAGE_CHECK"
  | "TECH_TRIAGE"
  | "SCHEDULE_TECH"
  | "SCHEDULE_CALLBACK"
  | "SERVICE_AVAILABILITY"
  | "AGENT_REQUEST"
  | "UNKNOWN";

export const ALL_INTENTS: readonly Intent[] = [
  "CHECK_BALANCE",
  "MAKE_PAYMENT",
  "PAYMENT_HISTORY",
  "BILLING_DUE_DATE",
  "PAYMENT_PROMISE",
  "PLAN_INFO",
  "PLAN_CHANGE",
  "AUTOPAY_STATUS",
  "OUTAGE_CHECK",
  "TECH_TRIAGE",
  "SCHEDULE_TECH",
  "SCHEDULE_CALLBACK",
  "SERVICE_AVAILABILITY",
  "AGENT_REQUEST",
  "UNKNOWN",
];

export type CallActionType = "PAYMENT" | "PLAN_CHANGE" | "PAYMENT_PROMISE" | "TECH_VISIT" | "CALLBACK";
export type CallActionStatus = "COMPLETED" | "SCHEDULED" | "DONE" | "CANCELLED";

export type EscalationReason =
  | "PIN_LOCKOUT"
  | "OTP_FAILED"
  | "VERIFICATION_FAILED"
  | "CALLER_REQUESTED"
  | "UNRESOLVED_REQUEST"
  | "BAN_LOOKUP_FAILED"
  | "NEW_CUSTOMER_ENROLLMENT";
export type EscalationStatus = "WAITING" | "ACCEPTED" | "RESOLVED";

export type Language = "en-US" | "es-US" | "hi-IN";
