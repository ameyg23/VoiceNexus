# Voice Nexus — Architecture & Technical Design

Status: **Built (POC).** This document describes the system as implemented. Product requirements are in `PRD-VoiceNexus (1).docx`; day-to-day status and decisions are in `CLAUDE.md`.

Scope: an AI IVR for a service provider's care line (demo tenant: Springfield Fiber). Callers are identified by account number (BAN) and verified by PIN or a one-time code; the assistant then answers or completes routine requests, and hands anything it can't do to a live agent (with context) or books a callback. Operations run it from a dashboard. Built zero-cost-first: every paid service has a free path.

---

## 1. System Architecture

```
  Browser demo (/demo/call)                 Phone caller ──► Twilio care line
  Web Speech STT + speechSynthesis TTS       (or browser mic via Voice JS SDK, /admin/test-call)
  MediaRecorder recording                         │  <Gather speech|dtmf> / <Say> / <Start><Recording>
            │ JSON turns                          │  signed webhooks (routes/twilio.ts)
            ▼                                     ▼
  ┌──────────────────────────── Server (Node/TS, Express) ────────────────────────────┐
  │  lib/conversations.ts   one lifecycle for both channels (start, turns, end)        │
  │                                                                                     │
  │  lib/authStateMachine.ts   ◄── the decision maker (deterministic code)              │
  │    stage:   AWAITING_INTENT → AWAITING_BAN → AWAITING_PIN | AWAITING_OTP →          │
  │             AUTHENTICATED  (or FAILED)                                              │
  │    subflow: confirm payment · plan change · payment promise · technician visit ·   │
  │             callback · escalation offer · CSAT survey                               │
  │        │ asks for language help only          │ reads/writes only authorized data  │
  │        ▼                                      ▼                                     │
  │  lib/extraction.ts + lib/aiEngine.ts     lib/businessLogic.ts, actions.ts,          │
  │   (Gemini: slots, intent, phrasing,       escalations.ts, otpService.ts, email.ts   │
  │    translation; deterministic fallback)                                             │
  │                                                                                     │
  │  lib/settings.ts  per-tenant config (voice, language, prompts, disclosures, rules)  │
  └───────────────────────────────────────┬─────────────────────────────────────────────┘
                                          ▼
                     SQLite (packages/db) + storage/recordings/
                                          ▲
  Next.js web (apps/web): /login, /signup · customer portal /portal/account ·
  ops dashboard /admin/* (calls, customers, intents, escalations, follow-ups, reports, settings)
```

**Key design principle:** the AI never makes a verification or account decision. It turns speech into structured values (BAN, PIN, code, intent, date, plan, yes/no) and turns pre-approved data into speech. The state machine validates every value against the database, decides what the caller may hear, and executes transactions — and only after an explicit "yes" for anything irreversible.

---

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| AI | Google Gemini `gemini-3.1-flash-lite` (free tier), plain REST `fetch` | Structured JSON output; 2 attempts on 429/503; every call degrades to a deterministic fallback |
| Speech (demo) | Browser Web Speech API + `speechSynthesis` | Chrome/Edge; typed input fallback |
| Speech (phone) | Twilio `<Gather input="speech dtmf">` + `<Say>` (Amazon Polly voices) | Turn-based, same loop as the demo; keypad works for BAN/PIN/OTP |
| Telephony | Twilio (one trial number) + Voice JS SDK browser calls | See §19 |
| Email OTP | Resend (sandbox sender `onboarding@resend.dev`) | Delivers only to the account owner's inbox until a domain is verified |
| SMS OTP | Dev console only | No free SMS provider |
| Database | SQLite via Node's built-in `node:sqlite` | No native build step |
| Recordings | Local disk `storage/recordings/` | `.webm` (demo) or `.mp3` (Twilio) |
| Backend | Node 24 + TypeScript + Express, zod validation | `tsx watch` in dev |
| Frontend | Next.js 15.5 App Router, React 18.3, Tailwind v4 | Hand-scaffolded, no chart/icon libraries |
| Auth | bcrypt + JWT in httpOnly cookies | Separate employee / customer sessions (§17) |

## 3. Cost

Everything runs free: Gemini free tier, browser speech, SQLite, local disk, Resend free tier (3,000/mo). The only metered piece is Twilio, which draws on trial credit and is used for a small, deliberate batch of real calls only (CLAUDE.md testing policy). Voice quality in the browser demo depends on the OS/browser voices.

---

## 4–9. Data Schemas (SQLite, `packages/db/migrations/`)

Migrations run on every `npm run db:migrate` (no tracking table); `ALTER TABLE ADD COLUMN` re-runs are treated as already-applied.

| Table | Purpose | Key columns |
|---|---|---|
| `customers` | Accounts | `id` CUS001…, `ban` (unique), `pin_hash`, `email` (unique, case-insensitive — 004), `mfa_method` NONE/EMAIL/SMS, balances & dates, `plan_name`, `portal_password_hash` (002), `service_zip` (005) |
| `conversations` | One per call | `id` VN-000001…, `ani` (display only), `ban_provided`, `customer_id`, `auth_status`, `auth_method`, `detected_intent` (first meaningful), `status`, times, `audio_path`, `channel` DEMO/PHONE + `twilio_call_sid` (003), `csat_score` (005) |
| `transcript_turns` | Every line said | `speaker` AI/CUSTOMER, `text`, `timestamp`, `latency_ms` for AI replies (005) |
| `auth_sessions` | Live engine state per call | `stage`, `customer_id`, `pin_attempts`, `subflow` JSON, `unknown_streak` (005) |
| `otps` | One-time codes | bcrypt `code_hash`, `method`, masked destination, 5-min expiry, 3 attempts, status |
| `employees` | Ops users | bcrypt `password_hash`, `role` |
| `call_actions` | Transactions & bookings (005) | `type` PAYMENT / PLAN_CHANGE / PAYMENT_PROMISE / TECH_VISIT / CALLBACK, `status` COMPLETED / SCHEDULED / DONE / CANCELLED, `details` JSON, `scheduled_for` |
| `escalations` | Live-agent handoffs (005) | `reason`, `verified`, `intent`, deterministic `summary`, `attempted` JSON, `status` WAITING / ACCEPTED / RESOLVED, agent + notes |
| `outages` | Known outages by service ZIP (005) | `service_zip`, `description`, `eta`, `active` |
| `tenant_settings` | Operator overrides (005) | `key` → JSON `value`; defaults live in `lib/settings.ts` |

Call **outcome** is derived, not stored (`lib/outcome.ts`), so every page counts the same way: ESCALATED (handoff or failed verification) › CALLBACK (callback booked) › RESOLVED (verified and served) › IN_PROGRESS › ABANDONED. A call left in progress for over an hour counts as ended.

---

## 10. API

**Calls (demo channel, public):** `POST /api/calls/start` · `POST /api/calls/:id/turn` → `{ aiText, speechText, stage, authStatus, endCall, transfer }` (409 once the call has ended) · `POST /api/calls/:id/end` · `POST /api/calls/:id/audio` · `GET /api/demo/customers` · `GET /api/demo/config`

**Phone channel:** `POST /api/twilio/{voice, gather, pending, status, recording, client-voice}` (Twilio-signed) · `GET /api/twilio/token` (employee)

**Web auth:** `POST /api/auth/login` (one form; employees first, then customers; returns `redirectTo`) · `POST /api/auth/logout` · `GET /api/auth/session` · `POST /api/auth/customer/signup` · `GET /api/auth/customer/{me, activity}` · `POST /api/auth/employee/signup` (employee session required) · `GET /api/auth/employee/me`

**Ops (employee session):** `GET /api/dashboard/{summary, reports, intents, integrations}` · `GET /api/conversations[?q&outcome&intent&channel]` · `GET /api/conversations/:id[/audio]` · `GET /api/customers[/:id]` · `GET|PUT /api/settings` · `GET /api/escalations[?status]` · `POST /api/escalations/:id/{accept, resolve}` · `GET /api/actions[?type&status]` · `POST /api/actions/:id/status`

**Dev (DEMO_MODE only, refuses proxied requests):** `GET /api/dev/otp/:conversationId`

---

## 11–12. Conversation Engine & AI

**Stages** gate data: nothing account-specific is spoken before AUTHENTICATED. ANI never authenticates.

**Goal-directed:** the intent heard at the start ("what's my balance?") is served straight after verification, without asking again.

**Intents (14):** CHECK_BALANCE, MAKE_PAYMENT, PAYMENT_HISTORY, BILLING_DUE_DATE, PAYMENT_PROMISE, PLAN_INFO, PLAN_CHANGE, AUTOPAY_STATUS, OUTAGE_CHECK, TECH_TRIAGE, SCHEDULE_TECH, SCHEDULE_CALLBACK, AGENT_REQUEST, UNKNOWN. Operations can disable an intent or add example utterances (fed to the classifier).

**Subflows** (`auth_sessions.subflow`): each irreversible action is read back and needs a yes; "cancel"/"never mind" backs out with nothing changed.
- Payment: read balance → confirm → charge (re-checks the balance at commit time).
- Plan change: list plans with prices → pick by speech ("the gig one without TV") → confirm → effective next bill.
- Payment promise: date up to 14 days out → confirm.
- Outage / tech triage: known outage for the service ZIP first; else scripted troubleshooting → offer a technician → day (next 7) + morning/afternoon → confirm.
- Callback: day + window (works before verification, uses the caller's number) → confirm.
- CSAT: 1–5 after a verified call's goodbye.

**Extraction order:** BAN/PIN/OTP: deterministic parser first (digits said or keyed, "4 8 2 1"), Gemini for number words. Intent: keypad menu digit → Gemini → keywords. Dates: deterministic (today, tomorrow, weekdays, "the 30th", "Sept 30") → Gemini → re-prompt. Yes/no: regex → Gemini → re-ask. Plans: deterministic matcher (handles "fastest", negated TV) → Gemini.

**Phrasing:** read-only answers are phrased by Gemini in the operator's brand voice from server-selected fields only (`businessLogic.getIntentResponseData`); on any AI failure a deterministic template gives the same facts. Non-English tenants get the final reply translated (English fallback).

**Out-of-flow rule (PRD §6):** never guess. First miss → say so and offer the keypad menu (degraded-mode IVR). Repeated misses (setting) or a disabled intent → state the limit, offer a live agent or a callback.

**Escalation rules:** caller asks for a person (any time), 3 wrong PINs, OTP attempts exhausted, repeated misunderstanding. `lib/escalations.ts` writes a structured handoff from recorded state only: identity verified or not (and how), intent, what was attempted (BAN, PIN attempts, OTPs, transactions), the caller's last words.

## 13. Recording

Demo: MediaRecorder `.webm` uploaded at call end. Phone: Twilio `<Start><Recording>` dual-channel `.mp3` downloaded on the recording callback. Both land in `storage/recordings/{conversationId}` and stream from `/api/conversations/:id/audio`. Operations can switch recording off (then neither channel records, and the greeting drops the recording notice).

## 14. Transcript

Every caller line and AI reply is stored in order with timestamps; AI replies also store server latency. The Calls list searches transcript text. Call detail refreshes live while a call is in progress (agent-assist view).

## 15. Dashboard (`/admin/*`, employee session)

Dashboard (KPIs, outcomes, intents, recent calls) · Calls (search/filter/CSV) + Call detail (transcript, recording, handoff, actions, auth trail) · Customers + detail (bookings & transactions, calls) · Intents (enable/disable, examples) · Escalations (live queue, accept/resolve) · Follow-ups (callbacks, technician visits, payment promises, transactions) · Reports (business-impact KPIs, trends, intent performance, verification funnel, handle time, CSAT, latency) · Integrations · Test Call · Settings. Responsive: sidebar becomes a drawer below laptop width.

Customer portal (`/portal/account`): balance and due date, plan, last payment, care-line help card, upcoming bookings, recent activity.

## 16. Folder Structure

```
apps/server/src/lib      engine, AI, extraction, dates, settings, actions, escalations, OTP, email, auth
apps/server/src/routes   calls, twilio, auth, customerAuth, employeeAuth, conversations, customers,
                         dashboard, operations (settings/escalations/actions), dev
apps/server/scripts      scenario-test, intent-eval, twilio-setup, twilio-webhook-smoke
apps/web/app             login, signup, portal/account, admin/*, demo/call, demo/otp-console
apps/web/components      AdminShell, Sidebar, AuthLayout, CallsTable, charts, Badge, icons, TopBar
packages/db              migrations 001–005, seed
packages/shared          shared types (Intent, CallOutcome, …)
storage/recordings       audio (gitignored)
```

## 17. Security

- PINs, passwords and OTPs are bcrypt-hashed; hashes never leave the server. OTP plaintext only goes to the customer's email or the dev console (DEMO_MODE, local requests only).
- Verification is enforced in code before any account field is read for a caller; the AI only ever receives fields already cleared for the current intent.
- Two independent web sessions (employee / customer): different cookie names and JWT audiences, verified separately. JWT secret read at call time from `.env`.
- Public sign-up creates customers only; creating an employee requires an employee session. Emails are unique across both.
- Twilio webhooks are signature-validated against `PUBLIC_BASE_URL`.
- zod validation on every request body and on tenant settings (a bad setting can't reach a live call).

## 18. Demo Mode

`/demo/call` lets you pick a seeded customer, which only sets the simulated caller ID. The caller must still give a BAN and pass PIN/OTP. SMS codes (and Email-OTP codes for customers other than Dana, CUS004) appear in `/demo/otp-console`.

## 19. Real Telephony

The Twilio care line drives the same engine as the demo; only audio I/O differs. `/gather` answers within a 9 s budget (Twilio abandons webhooks at 15 s) and otherwise plays the hold prompt and `<Redirect>`s to `/pending` until the turn finishes. Transfers `<Dial>` the operator's agent number when configured; otherwise the handoff is queued and the call ends. Browser test calls: Voice JS SDK → TwiML App → `/client-voice`, which dials the care-line number (or runs the IVR directly as a fallback). Setup: `npm run twilio:setup --workspace=apps/server -- <ngrok https URL>` (creates API key + TwiML App, points the number's webhooks, writes `.env`).

## 20. Testing

| Command | What it proves |
|---|---|
| `npm run test:scenarios --workspace=apps/server` | 69 end-to-end checks over the HTTP API against a server started with `PORT=4100 GEMINI_API_KEY= RESEND_API_KEY= DEMO_MODE=true` (deterministic, no AI quota). Every PRD flow, confirmations, cancel, lockout, menu fallback, settings, and the ops APIs. Snapshots and restores all data it touches. |
| `npm run eval:intents --workspace=apps/server [-- --ai]` | Intent F1 on a 42-utterance curated set (PRD target 0.90). Keyword path 0.905; Gemini path 1.000. |
| `npm run twilio:smoke --workspace=apps/server -- <baseUrl>` | Signed, simulated phone call through the Twilio webhooks (no credit). Delete the `CAsmoke…` conversations afterwards. |
| `npm run typecheck --workspaces` / `next build` | Types and production build. |

## Known limits

- Median reply latency is 2–6 s on turns that need Gemini (free tier); the PRD target is ≤ 1 s. Digit-only turns reply in milliseconds.
- Spanish/Hindi and the agent `<Dial>` transfer are implemented but not yet exercised on a real call.
- SMS OTP is console-only; Email OTP reaches only the Resend account owner's inbox (Dana, CUS004).
