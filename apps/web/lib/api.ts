import type {
  AuthMethod,
  AuthStage,
  AuthStatus,
  CallActionStatus,
  CallActionType,
  CallOutcome,
  Channel,
  EmployeeRole,
  EscalationReason,
  EscalationStatus,
  Intent,
  Language,
} from "@voice-nexus/shared";

export type { EscalationReason } from "@voice-nexus/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface DemoCustomer {
  id: string;
  name: string;
  phoneNumber: string;
  phoneNumberMasked: string;
}

export interface TurnResponse {
  aiText: string;
  // aiText with the operator's pronunciation overrides applied — what TTS should say.
  speechText: string;
  stage: AuthStage;
  authStatus: AuthStatus;
  // The assistant ended the call (goodbye, handoff to an agent, callback booked before verification).
  endCall?: boolean;
  transfer?: boolean;
}

export interface StartCallResponse extends TurnResponse {
  conversationId: string;
  language: Language;
  recordingEnabled: boolean;
}

export interface DemoConfig {
  brandName: string;
  assistantName: string;
  language: Language;
  recordingEnabled: boolean;
  careLineNumber: string | null;
}

export async function fetchDemoConfig(): Promise<DemoConfig> {
  return jsonOrThrow<DemoConfig>(await fetch(`${API_URL}/api/demo/config`));
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDemoCustomers(): Promise<DemoCustomer[]> {
  const res = await fetch(`${API_URL}/api/demo/customers`);
  const data = await jsonOrThrow<{ customers: DemoCustomer[] }>(res);
  return data.customers;
}

// Public (no session needed) equivalents of the customer-auth-gated /plans and
// /service-availability endpoints below, for the public homepage (/) where a visitor isn't signed
// in yet. Same PLAN_CATALOG / service_areas data either way - see apps/server/src/index.ts.
export async function fetchPublicPlans(): Promise<PlanInfo[]> {
  const res = await fetch(`${API_URL}/api/demo/plans`);
  const data = await jsonOrThrow<{ plans: PlanInfo[] }>(res);
  return data.plans;
}

export async function checkPublicAvailability(zip: string, accountType: "RESIDENTIAL" | "BUSINESS") {
  const res = await fetch(`${API_URL}/api/demo/service-availability?zip=${encodeURIComponent(zip)}&accountType=${accountType}`);
  return jsonOrThrow<{ zip: string; accountType: string; available: boolean }>(res);
}

export async function startCall(demoPhoneNumber: string): Promise<StartCallResponse> {
  const res = await fetch(`${API_URL}/api/calls/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demoPhoneNumber }),
  });
  return jsonOrThrow<StartCallResponse>(res);
}

export async function sendTurn(conversationId: string, text: string): Promise<TurnResponse> {
  const res = await fetch(`${API_URL}/api/calls/${conversationId}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return jsonOrThrow<TurnResponse>(res);
}

export async function endCall(conversationId: string): Promise<{ conversationId: string; durationSeconds: number }> {
  const res = await fetch(`${API_URL}/api/calls/${conversationId}/end`, { method: "POST" });
  return jsonOrThrow(res);
}

export async function uploadCallAudio(conversationId: string, blob: Blob): Promise<{ audioPath: string }> {
  const formData = new FormData();
  formData.append("audio", blob, `${conversationId}.webm`);
  const res = await fetch(`${API_URL}/api/calls/${conversationId}/audio`, {
    method: "POST",
    body: formData,
  });
  return jsonOrThrow(res);
}

export async function fetchDevOtp(conversationId: string): Promise<{ conversationId: string; code: string }> {
  const res = await fetch(`${API_URL}/api/dev/otp/${conversationId}`);
  return jsonOrThrow(res);
}

// --- Unified website sign-in: one form for everyone; the server decides whether the credentials are
// an employee's (→ ops dashboard) or a customer's (→ account page) and returns where to go. ---

export interface SessionInfo {
  accountType: "employee" | "customer";
  redirectTo: string;
}

export function login(email: string, password: string) {
  return authFetch<SessionInfo>("/api/auth/login", { email, password });
}

export function logout() {
  return authFetch<{ ok: true }>("/api/auth/logout", {});
}

export function fetchSession() {
  return authFetch<SessionInfo>("/api/auth/session");
}

// --- Employee (admin/ops) auth — httpOnly cookie session, separate from customer auth below. ---

export interface EmployeeAccount {
  id: number;
  name: string;
  email: string;
  role: EmployeeRole;
}

async function authFetch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });
  return jsonOrThrow<T>(res);
}

export function employeeSignup(name: string, email: string, password: string) {
  return authFetch<{ employee: EmployeeAccount }>("/api/auth/employee/signup", { name, email, password });
}

export function employeeLogin(email: string, password: string) {
  return authFetch<{ employee: EmployeeAccount }>("/api/auth/employee/login", { email, password });
}

export function employeeLogout() {
  return authFetch<{ ok: true }>("/api/auth/employee/logout", {});
}

export function employeeMe() {
  return authFetch<{ employee: EmployeeAccount }>("/api/auth/employee/me");
}

// --- Ops dashboard data (employee session required on every call) ---

export interface ConversationSummary {
  id: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  ani: string;
  banProvided: string | null;
  customerId: string | null;
  customerName: string | null;
  authStatus: AuthStatus;
  authMethod: AuthMethod | null;
  detectedIntent: Intent | null;
  status: string;
  outcome: CallOutcome;
  escalationReason: EscalationReason | null;
  channel: Channel;
  hasAudio: boolean;
  turnCount: number;
  csatScore: number | null;
}

export interface CallAction {
  id: number;
  conversationId: string;
  customerId: string | null;
  customerName: string | null;
  type: CallActionType;
  status: CallActionStatus;
  details: Record<string, unknown>;
  scheduledFor: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Escalation {
  id: number;
  conversationId: string;
  customerId: string | null;
  customerName: string | null;
  ani: string;
  banProvided: string | null;
  verified: boolean;
  reason: EscalationReason;
  intent: Intent | null;
  summary: string;
  attempted: string[];
  routingCode: string | null;
  expectedRoutingCode: string;
  routingMatch: boolean;
  status: EscalationStatus;
  acceptedByName: string | null;
  notes: string | null;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
}


export interface ConversationDetail {
  conversation: ConversationSummary;
  turns: { turnIndex: number; speaker: "AI" | "CUSTOMER"; text: string; timestamp: string; latencyMs: number | null }[];
  authSession: { stage: AuthStage; pinAttempts: number; banAttempts: number; authenticatedAt: string | null } | null;
  otps: { method: "EMAIL" | "SMS"; destinationMasked: string; status: string; attempts: number; createdAt: string }[];
  actions: CallAction[];
  escalation: Escalation | null;
}

export interface Kpis {
  totalCalls: number;
  finishedCalls: number;
  resolved: number;
  escalated: number;
  callback: number;
  abandoned: number;
  inProgress: number;
  containmentRate: number | null;
  transferRate: number | null;
  callbackRate: number | null;
  abandonmentRate: number | null;
  avgHandleSeconds: number | null;
  csatAverage: number | null;
  csatResponses: number;
  costPerCall: number | null;
  handoffs: { total: number; withFullContext: number; waiting: number };
  latency: { turns: number; medianMs: number | null; p90Ms: number | null };
}

export interface DashboardSummary extends Kpis {
  callbackBacklog: number;
  actions: { type: CallActionType; count: number }[];
  authMethods: { method: AuthMethod; count: number }[];
  intents: { intent: Intent; count: number }[];
  recentCalls: ConversationSummary[];
}

export interface CustomerSummary {
  id: string;
  name: string;
  phoneNumber: string;
  ban: string;
  email: string;
  mfaMethod: "NONE" | "EMAIL" | "SMS";
  planName: string;
  accountStatus: string;
  currentBalance: number;
  pastDueAmount: number;
  lastPaymentAmount: number;
  lastPaymentDate: string | null;
  nextBillingDueDate: string | null;
  autopayEnabled: boolean;
  discountPercent: number;
  hasPortalAccount: boolean;
  serviceZip?: string | null;
  createdAt: string;
  callCount?: number;
  lastCallAt?: string | null;
}

export interface ReportsData {
  kpis: Kpis;
  csatDistribution: { score: number; count: number }[];
  actionsByType: { type: CallActionType; status: CallActionStatus; count: number }[];
  callsByDay: { day: string; total: number; resolved: number; escalated: number }[];
  callsByHour: { hour: number; total: number }[];
  intentPerformance: { intent: Intent; total: number; resolved: number; escalated: number; callback: number; abandoned: number }[];
  handleTime: {
    overall: { calls: number; avgSeconds: number | null };
    byOutcome: { outcome: CallOutcome; calls: number; avgSeconds: number | null }[];
  };
  funnel: { calls: number; banProvided: number; accountFound: number; verified: number };
  authMethods: { configured: "NONE" | "EMAIL" | "SMS"; attempted: number; verified: number; failed: number }[];
  escalationReasons: { reason: EscalationReason; count: number }[];
  channels: { channel: Channel; count: number }[];
}

export interface IntentCatalogEntry {
  intent: Intent;
  label: string;
  description: string;
  examples: string[];
  dataShared: string[];
  enabled: boolean;
  customExamples: string[];
  total: number;
  resolved: number;
  escalated: number;
}

export interface IntegrationsStatus {
  gemini: { configured: boolean; model: string };
  resend: { configured: boolean; fromEmail: string | null };
  twilio: { configured: boolean; careLineNumber: string | null; publicBaseUrl: string | null; voiceSdkConfigured: boolean };
  demoMode: boolean;
}

export function fetchDashboardSummary() {
  return authFetch<DashboardSummary>("/api/dashboard/summary");
}

export function fetchConversations(filters: { q?: string; outcome?: string; intent?: string; channel?: string } = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const qs = params.toString();
  return authFetch<{ conversations: ConversationSummary[] }>(`/api/conversations${qs ? `?${qs}` : ""}`);
}

export function fetchConversation(id: string) {
  return authFetch<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`);
}

export function conversationAudioUrl(id: string) {
  return `${API_URL}/api/conversations/${encodeURIComponent(id)}/audio`;
}

export function fetchCustomers() {
  return authFetch<{ customers: CustomerSummary[] }>("/api/customers");
}

export function fetchCustomer(id: string) {
  return authFetch<{
    customer: CustomerSummary;
    conversations: ConversationSummary[];
    actions: CallAction[];
    stats: { total: number; resolved: number; escalated: number };
  }>(
    `/api/customers/${encodeURIComponent(id)}`
  );
}

export function fetchReports() {
  return authFetch<ReportsData>(`/api/dashboard/reports?tzOffset=${new Date().getTimezoneOffset()}`);
}

export function fetchIntents() {
  return authFetch<{ intents: IntentCatalogEntry[] }>("/api/dashboard/intents");
}

export function fetchIntegrations() {
  return authFetch<IntegrationsStatus>("/api/dashboard/integrations");
}

export interface TenantSettings {
  brandName: string;
  assistantName: string;
  voiceTone: string;
  language: Language;
  phoneVoice: string;
  pronunciations: { from: string; to: string }[];
  greetingPrompt: string;
  holdPrompt: string;
  closePrompt: string;
  aiDisclosureEnabled: boolean;
  aiDisclosureText: string;
  recordingEnabled: boolean;
  recordingDisclosureEnabled: boolean;
  recordingDisclosureText: string;
  csatSurveyEnabled: boolean;
  escalateOnAgentRequest: boolean;
  unknownTurnsBeforeEscalation: number;
  agentTransferNumber: string;
  routingCodes: { generalEnquiry: string; newCustomerResidential: string; newCustomerBusiness: string; byIntent: Partial<Record<Intent, string>> };
  intentOverrides: Record<string, { enabled: boolean; examples: string[] }>;
  costPerMinuteAutomated: number;
  costPerMinuteAgent: number;
  agentMinutesPerEscalation: number;
}

export interface SettingsResponse {
  settings: TenantSettings;
  defaults: TenantSettings;
  preview: { greeting: string; greetingSpoken: string };
}

export function fetchSettings() {
  return authFetch<SettingsResponse>("/api/settings");
}

export async function saveSettings(patch: Partial<TenantSettings>): Promise<SettingsResponse> {
  const res = await fetch(`${API_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    credentials: "include",
  });
  return jsonOrThrow<SettingsResponse>(res);
}

export function fetchEscalations(status?: "OPEN" | EscalationStatus) {
  return authFetch<{ escalations: Escalation[] }>(`/api/escalations${status ? `?status=${status}` : ""}`);
}

export function acceptEscalation(id: number) {
  return authFetch<{ escalation: Escalation }>(`/api/escalations/${id}/accept`, {});
}

export function resolveEscalation(id: number, notes: string) {
  return authFetch<{ escalation: Escalation }>(`/api/escalations/${id}/resolve`, { notes });
}

export function fetchActions(filters: { type?: CallActionType; status?: CallActionStatus } = {}) {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  return authFetch<{ actions: CallAction[] }>(`/api/actions${qs ? `?${qs}` : ""}`);
}

export function updateActionStatus(id: number, status: "DONE" | "CANCELLED") {
  return authFetch<{ action: CallAction }>(`/api/actions/${id}/status`, { status });
}

export function fetchVoiceToken() {
  return authFetch<{ token: string; careLineNumber: string | null }>("/api/twilio/token");
}

// Same shape as fetchVoiceToken, but customer-auth-gated — backs the portal's "Call customer care"
// browser-calling widget.
export function fetchCustomerVoiceToken() {
  return authFetch<{ token: string; careLineNumber: string | null }>("/api/twilio/customer-token");
}

// Same shape again, but for an anonymous visitor on the public homepage — no session at all, so the
// server rate-limits this one by IP instead (routes/twilio.ts).
export function fetchPublicVoiceToken() {
  return authFetch<{ token: string; careLineNumber: string | null }>("/api/twilio/public-token");
}

// --- Customer portal auth — separate httpOnly cookie session; unrelated to the phone-call
// BAN+PIN/OTP auth (authStateMachine.ts), which stays server-side-gated during a call. ---

export interface CustomerAccount {
  id: string;
  name: string;
  email: string;
  ban: string;
  planName: string;
  customerType: "RESIDENTIAL" | "BUSINESS";
  accountStatus: string;
  currentBalance: number;
  pastDueAmount: number;
  lastPaymentAmount: number;
  lastPaymentDate: string | null;
  nextBillingDueDate: string | null;
  autopayEnabled: boolean;
  discountPercent: number;
}

export function customerSignup(name: string, email: string, password: string) {
  return authFetch<{ customer: CustomerAccount }>("/api/auth/customer/signup", { name, email, password });
}

// The step that actually makes a signed-up-but-not-yet-a-customer account into a real one: assigns a
// BAN and a phone PIN, returned in plaintext exactly once so it can be shown to the customer.
export function purchasePlan(planName: string) {
  return authFetch<{ ban: string; pin: string; planName: string }>("/api/auth/customer/purchase-plan", { planName });
}

// Self-service plan switch on the existing session - no re-auth. The existing balance carries over;
// an upgrade adds the price difference on top (fake proration, no real billing gateway in this POC).
export function switchPlan(planName: string) {
  return authFetch<{ planName: string; charged: number; newBalance: number }>("/api/auth/customer/switch-plan", { planName });
}

export function customerLogin(email: string, password: string) {
  return authFetch<{ customer: CustomerAccount }>("/api/auth/customer/login", { email, password });
}

export function customerLogout() {
  return authFetch<{ ok: true }>("/api/auth/customer/logout", {});
}

export interface CustomerActivityItem {
  id: number;
  type: CallActionType;
  status: CallActionStatus;
  scheduledFor: string | null;
  window: string | null;
  description: string;
  createdAt: string;
}

export interface CustomerActivity {
  upcoming: CustomerActivityItem[];
  history: CustomerActivityItem[];
  recentCalls: { id: string; startTime: string; intent: Intent | null; outcome: CallOutcome }[];
  brandName: string;
  assistantName: string;
  careLineNumber: string | null;
}

export function customerActivity() {
  return authFetch<CustomerActivity>("/api/auth/customer/activity");
}

export function customerMe() {
  return authFetch<{ customer: CustomerAccount }>("/api/auth/customer/me");
}

export interface PlanInfo {
  name: string;
  monthlyPrice: number;
  description: string;
  audience: "RESIDENTIAL" | "BUSINESS";
}

// Same catalog the phone AI offers in the PLAN_CHANGE subflow, so "view plans" in the portal
// always matches what a call would actually offer.
export function fetchCustomerPlans() {
  return authFetch<{ plans: PlanInfo[] }>("/api/auth/customer/plans");
}

// Same service_areas lookup the phone flow's ZIP subflows use, so a web availability check always
// agrees with what a call would say.
export function checkServiceAvailability(zip: string, accountType: "RESIDENTIAL" | "BUSINESS") {
  return authFetch<{ zip: string; accountType: string; available: boolean }>(
    `/api/auth/customer/service-availability?zip=${encodeURIComponent(zip)}&accountType=${accountType}`
  );
}
