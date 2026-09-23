import type { AuthStage, AuthStatus, EmployeeRole } from "@voice-nexus/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface DemoCustomer {
  id: string;
  name: string;
  phoneNumber: string;
  phoneNumberMasked: string;
}

export interface TurnResponse {
  aiText: string;
  stage: AuthStage;
  authStatus: AuthStatus;
}

export interface StartCallResponse extends TurnResponse {
  conversationId: string;
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

export interface DashboardSummary {
  totalConversations: number;
  authSuccess: number;
  authFailed: number;
  authPending: number;
}

export function fetchDashboardSummary() {
  return authFetch<DashboardSummary>("/api/dashboard/summary");
}

// --- Customer portal auth — separate httpOnly cookie session; unrelated to the phone-call
// BAN+PIN/OTP auth (authStateMachine.ts), which stays server-side-gated during a call. ---

export interface CustomerAccount {
  id: string;
  name: string;
  email: string;
  ban: string;
  planName: string;
  accountStatus: string;
  currentBalance: number;
  pastDueAmount: number;
  lastPaymentAmount: number;
  lastPaymentDate: string | null;
  nextBillingDueDate: string | null;
  autopayEnabled: boolean;
  discountPercent: number;
}

export function customerSignup(name: string, email: string, password: string, pin: string) {
  return authFetch<{ customer: CustomerAccount }>("/api/auth/customer/signup", { name, email, password, pin });
}

export function customerLogin(email: string, password: string) {
  return authFetch<{ customer: CustomerAccount }>("/api/auth/customer/login", { email, password });
}

export function customerLogout() {
  return authFetch<{ ok: true }>("/api/auth/customer/logout", {});
}

export function customerMe() {
  return authFetch<{ customer: CustomerAccount }>("/api/auth/customer/me");
}
