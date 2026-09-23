# Voice Nexus

AI IVR for a service provider's care line (demo tenant: **Springfield Fiber**). Callers verify with their account number + PIN or a one-time code, then the assistant answers questions and handles routine requests — payments, plan changes, payment arrangements, outage checks, technician visits, callbacks — and hands anything else to a live agent with full context. Operations run it from a web dashboard.

Design: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Product requirements: `PRD-VoiceNexus (1).docx` · Working notes & status: [`CLAUDE.md`](CLAUDE.md)

## Run it

Requires Node 24+ and Chrome/Edge (for browser speech).

```bash
npm install
cp .env.example .env          # fill in GEMINI_API_KEY at minimum (see below)
npm run db:migrate
npm run db:seed               # only on a fresh database — it resets demo balances
npm run dev                   # API on :4000, web on :3000
```

Open http://localhost:3000.

| `.env` key | Needed for |
|---|---|
| `GEMINI_API_KEY` | AI understanding and phrasing (without it everything still works, deterministically) |
| `JWT_SECRET` | Web sessions |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Real email one-time codes |
| `TWILIO_*`, `PUBLIC_BASE_URL` | Real phone calls (see ARCHITECTURE.md §19) |

## Demo accounts

| Who | Sign in with | Password |
|---|---|---|
| Admin | `priya.sharma@voicenexus.demo` | `admin-demo-pass` |
| Customer | e.g. `amara.okafor@example.com` | `amara-demo-pass` (pattern: `<firstname>-demo-pass`) |

Phone verification uses the BAN and PIN, e.g. Amara Okafor `BAN100001` / `4821`. Customers 4–6 verify by email code and 7–9 by SMS code; codes appear in **Demo tools → OTP console**.

## Try a call

Admin sidebar → **Demo tools → Demo call**, pick a customer, then speak or type, e.g.:

1. "I want to upgrade my plan" → `100001` → `4821` → "the gig one without TV" → "yes"
2. "Can someone call me back tomorrow morning?" → "yes"
3. "Let me talk to a person" — then see **Escalations**

## Tests

```bash
# deterministic end-to-end scenarios (start this server first, in another terminal)
cd apps/server && PORT=4100 GEMINI_API_KEY= RESEND_API_KEY= DEMO_MODE=true node --import tsx src/index.ts
npm run test:scenarios --workspace=apps/server

npm run eval:intents --workspace=apps/server          # intent F1 (add -- --ai for the Gemini path)
npm run typecheck --workspaces
```
