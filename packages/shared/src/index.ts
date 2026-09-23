// Shared types — mirrors packages/db schema (ARCHITECTURE.md §4-9).
// Server is the source of truth for validation; these are for compile-time safety only.

export type MfaMethod = "NONE" | "EMAIL" | "SMS";

export interface Customer {
  id: string; // e.g. CUS001
  name: string;
  phoneNumber: string; // E.164; ANI source, never used for auth
  ban: string; // e.g. BAN100001
  pinHash: string; // bcrypt, never sent to frontend
  email: string;
  mfaEnabled: boolean;
  mfaMethod: MfaMethod;
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
export type CallOutcome = "RESOLVED" | "ESCALATED" | "ABANDONED" | "IN_PROGRESS";

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

// Intents recognized by the AI engine (VN-1 / VN-4 scope: billing, account, plan, simple tech triage).
export type Intent =
  | "CHECK_BALANCE"
  | "MAKE_PAYMENT"
  | "PAYMENT_HISTORY"
  | "BILLING_DUE_DATE"
  | "PLAN_INFO"
  | "AUTOPAY_STATUS"
  | "TECH_TRIAGE"
  | "UNKNOWN";
