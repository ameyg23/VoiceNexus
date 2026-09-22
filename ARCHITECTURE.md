# Voice Nexus — Architecture & Technical Design

Status: **Draft for approval — no application code has been written yet.**
Scope: Proof-of-concept demonstrating the complete flow in the spec (ANI capture → BAN → PIN/OTP auth → intent → protected data → recording/transcript → dashboard), built at zero mandatory cost.

---

## 1. System Architecture

```
┌─────────────────────────┐
│   Browser (Demo Call)   │
│  - Customer selector    │
│  - Mic capture (MediaRecorder)
│  - Web Speech API (STT) │
│  - speechSynthesis (TTS)│
└───────────┬──────────────┘
            │ HTTPS (turn-by-turn text) + audio upload at call end
            ▼
┌─────────────────────────────────────────────────────────┐
│                     Server (Node/TS)                     │
│                                                           │
│  ┌───────────────┐   ┌────────────────────────────────┐ │
│  │ Auth State     │◄──┤ AI Engine (Claude)              │ │
│  │ Machine        │   │ - slot extraction (BAN/PIN/OTP) │ │
│  │ (deterministic)│   │ - intent classification         │ │
│  │                │   │ - response phrasing (NLG only)  │ │
│  └───────┬────────┘   └────────────────────────────────┘ │
│          │ enforces "authenticated?" before any data leaves│
│          ▼                                                │
│  ┌────────────────┐   ┌──────────────┐   ┌─────────────┐ │
│  │ Business Logic  │◄─►│ OTP Service   │   │ Recording/   │ │
│  │ (account lookup)│   │ (gen/verify,  │   │ Transcript   │ │
│  │                 │   │ email/dev-SMS)│   │ Service      │ │
│  └───────┬─────────┘   └──────────────┘   └──────┬───────┘ │
│          ▼                                        ▼        │
│  ┌────────────────────────────────────────────────────┐   │
│  │  SQLite (customers, conversations, otps, employees) │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
└────────────────────┬────────────────────────────────────┘
                      │
                      ▼
        ┌───────────────────────────┐
        │  Company Dashboard (Next.js)│
        │  - login (employee auth)    │
        │  - stats, customers list    │
        │  - conversations + player   │
        │    + transcript viewer      │
        └───────────────────────────┘
```

**Key design principle (directly enforcing your section 13/24 rule):** the LLM never sees or utters protected account data until the *server-side* Auth State Machine has independently marked the conversation `AUTHENTICATED`. The LLM's job is language in/out (understanding what the caller said, phrasing what to say back) — never the authorization decision. This is enforced in code, not just in the prompt.

---

## 2. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| AI Conversation Engine | **Claude** (Anthropic API, e.g. Haiku for cost/speed) | Strong structured JSON/tool-call output for slot extraction; you confirmed this. Requires your own `ANTHROPIC_API_KEY` (see §3 — not strictly free-tier). |
| Speech-to-Text | **Browser Web Speech API** | Built into Chrome, zero cost, zero key, streaming. Runs client-side. |
| Text-to-Speech | **Browser `speechSynthesis`** | Zero cost, zero key, per your choice. |
| Email OTP delivery | **Resend or Brevo free tier** | Real inbox delivery, no credit card, generous free daily quota. Per your choice. |
| SMS OTP delivery | **Dev console only** | No free real-SMS provider exists; spec explicitly allows a dev-console fallback (§8/§22). |
| Database | **SQLite** (file-based) | Zero cost, zero hosting, zero quota, trivial to seed/reset for a demo. |
| Audio storage | **Local disk** (`storage/recordings/`) | Zero cost. Abstracted behind a storage interface so swapping to cloud storage later is a one-file change. |
| Backend | **Node.js + TypeScript (Express) + ws** | Handles turn-based API + a WebSocket for live call state push to the dashboard "live calls" view (stretch) and to keep the pipeline swap-ready for real telephony streaming later. |
| Frontend | **Next.js (React) + TypeScript** | One app serving both the public `/demo/call` page and the authenticated `/dashboard/*` pages. |
| Employee auth | **Local credentials + bcrypt + JWT (httpOnly cookie)** | No external auth provider needed — zero cost, zero dependency. |
| Password/PIN hashing | **bcrypt** | Industry standard, free, local. |

---

## 3. Free-Tier Verification (per service)

| Service | Free tier? | Card required? | Cost after quota | Notes |
|---|---|---|---|---|
| Claude API | Small starter credit only, not a standing free tier | Yes, eventually for continued use | Pay-per-token | **Documented exception** — you explicitly chose this. Haiku model keeps cost low; POC-scale usage (dozens of demo calls) should stay within a few dollars at most, likely within any starter credit. |
| Browser Web Speech API | Unlimited, free forever | No | N/A | Chrome/Edge only; not available in Firefox/Safari — demo must run in Chromium browser. |
| Browser `speechSynthesis` | Unlimited, free forever | No | N/A | Voice quality/naturalness is OS/browser-dependent. |
| Resend | 3,000 emails/mo, 100/day free | No | Paid plan | Free tier sufficient for demo volume. |
| Brevo (alt.) | 300 emails/day free | No | Paid plan | Backup if Resend signup is inconvenient. |
| SQLite | Unlimited, free forever | No | N/A | Local file; no hosting. |
| Local disk storage | Unlimited (bounded by your disk) | No | N/A | Fine for POC-scale audio files. |
| Node/Next.js/Express/bcrypt/jsonwebtoken | Open source | No | N/A | All MIT-licensed, no runtime cost. |

**No real telephony (Twilio/Telnyx/etc.) is used in this POC** — real phone numbers and call minutes are never free, so per your §21/§22 instruction we build **Demo Mode** as the actual deliverable, with a documented (not implemented) path to swap in real telephony later (§19 below).

---

## 4–9. Data Schemas (SQLite)

### `customers`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | e.g. `CUS001` |
| name | TEXT | |
| phone_number | TEXT | E.164; this is ANI source, **never used for auth** |
| ban | TEXT UNIQUE | e.g. `BAN100001` |
| pin_hash | TEXT | bcrypt hash, never plaintext, never sent to frontend |
| email | TEXT | fake/demo address you control, for real OTP delivery |
| mfa_enabled | BOOLEAN | |
| mfa_method | TEXT | `NONE` \| `EMAIL` \| `SMS` |
| current_balance | REAL | |
| last_payment_amount | REAL | |
| last_payment_date | TEXT | |
| next_billing_due_date | TEXT | |
| past_due_amount | REAL | |
| discount_percent | REAL | |
| autopay_enabled | BOOLEAN | |
| plan_name | TEXT | |
| account_status | TEXT | |
| created_at | TEXT | |

Seed: 5–10 fake customers covering all three auth configs (PIN-only, Email OTP, SMS OTP), per your example table.

### `conversations`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | display code `VN-000001` |
| customer_id | TEXT NULL | resolved only after BAN validated |
| ani | TEXT | captured at call start (demo customer's phone number), display-only |
| ban_provided | TEXT NULL | |
| auth_status | TEXT | `PENDING` \| `SUCCESS` \| `FAILED` |
| auth_method | TEXT NULL | `PIN` \| `EMAIL_OTP` \| `SMS_OTP` |
| detected_intent | TEXT NULL | primary intent for the call |
| status | TEXT | `IN_PROGRESS` \| `COMPLETED` \| `ABANDONED` |
| start_time / end_time | TEXT | |
| duration_seconds | INTEGER | |
| audio_path | TEXT NULL | path under `storage/recordings/` |
| created_at | TEXT | |

### `transcript_turns`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| conversation_id | TEXT FK | |
| turn_index | INTEGER | |
| speaker | TEXT | `AI` \| `CUSTOMER` |
| text | TEXT | |
| timestamp | TEXT | |

### `auth_sessions` (live state machine per in-progress conversation)
| Column | Type | Notes |
|---|---|---|
| conversation_id | TEXT PK/FK | |
| stage | TEXT | `AWAITING_INTENT` → `AWAITING_BAN` → `AWAITING_PIN`/`AWAITING_OTP` → `AUTHENTICATED` → `FAILED` |
| customer_id | TEXT NULL | set once BAN resolves |
| pin_attempts | INTEGER | max 3, then `FAILED` |
| authenticated_at | TEXT NULL | |

### `otps`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| conversation_id | TEXT FK | |
| customer_id | TEXT FK | |
| code_hash | TEXT | hashed at rest, never stored plaintext in DB |
| method | TEXT | `EMAIL` \| `SMS` |
| destination_masked | TEXT | e.g. `c***A@example.com` |
| created_at / expires_at | TEXT | 5-minute expiry |
| attempts | INTEGER | max 3 |
| status | TEXT | `PENDING` \| `VERIFIED` \| `EXPIRED` \| `FAILED` |

Plaintext OTP is only ever: (a) emailed to the real address via Resend, for EMAIL method; (b) written to a **dev-only admin console log**, clearly labeled, for SMS method (since no free SMS exists) — never returned in any customer-facing API response, and never spoken by the AI.

### `employees`
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| name / email | TEXT | |
| password_hash | TEXT | bcrypt |
| role | TEXT | `ADMIN` \| `AGENT` \| `VIEWER` |

---

## 10. API Design

**Demo call flow (public-ish, no employee auth needed — this simulates the customer side):**
- `GET /api/demo/customers` — list demo customers (name + masked phone only, for the "Select Customer" dropdown)
- `POST /api/calls/start` — body `{ demoPhoneNumber }` → creates `conversation` (status `IN_PROGRESS`, ani captured), returns `conversationId` + AI's opening greeting
- `POST /api/calls/:id/turn` — body `{ text }` (the transcribed customer utterance) → runs through Auth State Machine + Claude, returns `{ aiText, stage, authStatus }`
- `POST /api/calls/:id/end` — finalizes conversation, computes duration
- `POST /api/calls/:id/audio` — multipart upload of the recorded audio blob, stored + linked

**OTP dev console (dev-only, env-flagged):**
- `GET /api/dev/otp/:conversationId` — returns the current plaintext OTP for that conversation, **only when `DEMO_MODE=true`**

**Dashboard (employee-auth required, JWT cookie):**
- `POST /api/auth/login`
- `GET /api/dashboard/summary`
- `GET /api/customers`, `GET /api/customers/:id`
- `GET /api/conversations` (filter/search)
- `GET /api/conversations/:id`
- `GET /api/conversations/:id/audio` (streams the file)

---

## 11–12. AI & Voice Architecture

- **Turn loop:** browser STT transcribes an utterance → POSTs text to `/api/calls/:id/turn` → server loads `auth_sessions.stage` → calls Claude with a **stage-scoped prompt** (only the instructions/tools relevant to the current stage, e.g. at `AWAITING_BAN` the model's only job is "extract a BAN-like string from this utterance or ask for one") → server validates the extracted value against the DB directly (not trusting the model's claim) → server advances `stage` → server calls Claude again (or reuses the response) purely for **response phrasing**, only handing it data it's authorized to speak (e.g. post-auth, the specific account field needed for the detected intent — never the whole customer row).
- **Guardrail:** if Claude's extraction confidence is low or ambiguous, the state machine re-prompts ("I didn't catch that BAN, could you repeat it?") rather than guessing — mirrors the original PRD's "never fabricate an answer" principle.
- **TTS:** server returns `aiText`; browser calls `speechSynthesis.speak()`.

---

## 13. Recording Architecture

- Browser `MediaRecorder` captures mic audio for the whole call (local blob, `audio/webm`).
- On `POST /api/calls/:id/end`, browser uploads the blob to `/api/calls/:id/audio`.
- Server writes to `storage/recordings/{conversationId}.webm`, sets `conversations.audio_path`.
- Dashboard conversation detail page streams it via `<audio controls src="/api/conversations/:id/audio">`.

## 14. Transcript Architecture

- Each `/turn` call appends two rows to `transcript_turns` (customer utterance, then AI response) with timestamps — built incrementally, no post-processing needed.
- Dashboard renders them in order; searchable via a simple `LIKE` query on `text` for the conversations list (stretch: filter by intent/date/customer).

## 15. Dashboard Architecture

Next.js routes:
- `/login`
- `/dashboard` — totals, auth success/fail counts, method breakdown, recent activity
- `/customers`, `/customers/[id]`
- `/conversations`, `/conversations/[id]` — detail + audio player + transcript
- `/demo/call` — the customer-facing simulated call page (public)
- `/demo/otp-console` — dev-only OTP viewer, rendered only when `DEMO_MODE=true`

All `/dashboard`, `/customers`, `/conversations` routes sit behind employee-auth middleware (JWT cookie check).

## 16. Folder Structure

```
voice-nexus/
  apps/
    web/                 # Next.js: dashboard + /demo/call + /demo/otp-console
    server/               # Express + ws: state machine, AI engine, business logic, APIs
  packages/
    db/                   # SQLite schema/migrations + seed script (5-10 fake customers)
    shared/                # shared TS types: Customer, Conversation, Intent, AuthStage enums
  storage/
    recordings/            # local audio files (gitignored)
  .env.example
  package.json             # npm workspaces
```

## 17. Security Approach (mapped to your §24 rules)

- PIN/password: bcrypt hash, never sent to frontend, never logged.
- OTP: hashed at rest; plaintext only via the real email (Resend) or the explicitly dev-flagged console — never via any customer-facing API/AI response.
- Secrets (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, JWT secret) in `.env`, gitignored; `.env.example` checked in with empty placeholders.
- Backend independently enforces `AUTHENTICATED` before any protected-field lookup — verified in the business-logic layer, not delegated to the LLM.
- OTP: 5-minute expiry, 3-attempt max, resend supported (invalidates prior code).
- PIN: 3-attempt max per conversation, then `auth_status = FAILED` and the AI offers escalation-style closure (no further protected-data attempts allowed in that conversation).
- Dashboard routes behind employee login (bcrypt + JWT httpOnly cookie).
- Input validation (e.g. `zod`) on every API body.

## 18. Demo Mode Architecture

- `/demo/call` shows a customer selector (dropdown of the 5–10 seeded customers, by name + phone only).
- Selecting a customer only sets the **ANI** for the simulated call (`conversations.ani`) — it does **not** set `customer_id` or any auth state. `auth_sessions.stage` always starts at `AWAITING_INTENT` → `AWAITING_BAN`, exactly as it would for a real unknown caller.
- The customer must still type/say their BAN and complete PIN/OTP before any account data is revealed — this is the mechanism that proves ANI ≠ authentication throughout the whole POC.

## 19. Real Telephony Architecture (documented, not built)

To connect a real phone number later without re-architecting:
- Replace the browser mic/STT layer with **Twilio Voice + Media Streams** (or Telnyx) — inbound call triggers a webhook, audio is streamed to the server over a WebSocket.
- Replace browser STT with a server-side streaming STT (e.g. Deepgram or Google Cloud STT) fed by that same audio stream.
- The **Auth State Machine, Claude integration, business logic, DB schema, recording, and transcript pipeline are all reused unchanged** — only the audio I/O boundary swaps.
- TTS output is streamed back to the caller via Twilio's `<Play>`/media stream instead of `speechSynthesis`.
- Twilio also provides native call recording, which can replace the client-side `MediaRecorder` capture.
- Real SMS OTP becomes viable at this stage via Twilio SMS (paid, per-message).

## 20. Development Roadmap

1. **Scaffold** — monorepo, SQLite schema + migrations, seed 5–10 customers with mixed auth configs.
2. **Auth core (no AI yet)** — REST endpoints + state machine, rule-based BAN/PIN/OTP validation, testable via curl/Postman.
3. **AI integration** — wire Claude into slot extraction (BAN/PIN/OTP), intent classification, and response phrasing at each state.
4. **Demo call frontend** — customer selector, mic capture, Web Speech STT, `speechSynthesis` TTS, turn-based UI.
5. **Recording + transcript persistence** — audio upload on call end, transcript rows written per turn.
6. **Company dashboard** — employee login, summary stats, customers, conversations list/detail with player + transcript.
7. **Polish/stretch** — Resend email OTP wired in, dev OTP console, search/filter on conversations, live-call indicator via WebSocket.

---

## Open items for your review

1. Confirmed: Claude (Anthropic) as LLM, with the free-tier exception documented above — you'll need to supply `ANTHROPIC_API_KEY`.
2. Confirmed: browser `speechSynthesis` for TTS ($0, robotic-but-free).
3. Confirmed: real email OTP via Resend (or Brevo) — you'll need to sign up and supply an API key; SMS stays dev-console-only (no free real-SMS path exists).
4. Demo runs locally (`npm run dev`) — no hosting/deployment is in scope for this POC unless you want it.

Waiting for your go-ahead before writing any application code, per your instruction.
