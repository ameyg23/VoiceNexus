# Voice Nexus

AI IVR platform POC. Full product vision is in `PRD-VoiceNexus (1).docx`; the actual technical design being built is in `ARCHITECTURE.md` — read that first for schemas, API design, and folder structure. This file is the day-to-day driver so the plan doesn't need to be re-explained each session.

## Deadline & cadence

Started Tue 2026-09-22, due **Sun 2026-09-27**. Working in daily sessions — update the checklist below at the end of each day (check off what's done, note anything that slipped or changed) so the next session picks up state without a recap.

## Key decisions (don't re-litigate these)

- **Zero-cost-first POC**: browser mic + Web Speech API (STT) + `speechSynthesis` (TTS) is the primary build-and-test path all week. It's free and unlimited, so all iteration happens here.
- **Telephony provider: Twilio.** Chosen over Vapi/ElevenLabs because (a) it matches the swap-in path already documented in `ARCHITECTURE.md` §19 (Twilio Voice + Media Streams) with no rework, and (b) Vapi/ElevenLabs bundle orchestration around LLM-driven flow, which fights this project's deterministic server-side Auth State Machine (§17).
- **Two Twilio numbers**: one acts as the "care line" (what the app answers on), the other is the test caller leg. Both reserved early (cheap, one-time) — but not wired to real webhooks until the very end.
- **Testing policy — important**: do NOT place real Twilio calls iteratively during the week. Trial credit is limited and testing burns it fast. All logic gets verified via the browser Demo Mode and curl/Postman. Real phone calls happen **only on Sunday**, as a small deliberate batch of end-to-end verification calls — not a debugging loop. If a real call surfaces a bug, diagnose and fix it, re-verify via Demo Mode, and only place a fresh real call once you believe it's actually fixed.
- **AI engine: Google Gemini (free tier), not Claude.** Switched Sep 23 — Anthropic only offers a starter credit (documented as a cost exception in `ARCHITECTURE.md` §3), while Gemini has a genuine standing free tier, which fits the zero-cost-first approach better. The AI's job is unchanged regardless of provider: slot extraction, intent classification, and response phrasing only — it never makes the auth decision. The server-side Auth State Machine independently gates access to protected data (§17). `GEMINI_API_KEY` is in `.env`.

## Weekly plan

- [x] **Tue (Sep 22) — Scaffold**: monorepo (npm workspaces), SQLite schema + migrations, seed 9 customers across PIN/Email-OTP/SMS-OTP configs (3 each). Verified: migration runs, seed runs, server boots, `/api/demo/customers` returns correct data, typecheck clean, git initialized.
  - [ ] **Still outstanding (needs you, not Claude)**: sign up for Twilio, sign up for Resend, reserve both Twilio numbers. Deliberately deferred by user on Sep 22 — do whenever convenient, not blocking Wed/Thu work. Email OTP will use dev-console delivery until Resend is set up; Claude AI integration (Thu) doesn't depend on either.
- [x] **Wed (Sep 23) — Auth core (no AI yet)**: REST endpoints (`/api/calls/start`, `/:id/turn`, `/:id/end`, `/api/dev/otp/:conversationId`) + deterministic Auth State Machine (`apps/server/src/lib/authStateMachine.ts`), rule-based BAN/PIN/OTP extraction (regex placeholder — Claude swaps in Thursday). OTP service hashed at rest, dev-console delivery (Resend not wired yet — deferred). Verified via curl: PIN-only flow, Email OTP flow, SMS OTP + resend flow, 3-strikes PIN lockout → FAILED/escalation, unknown BAN re-prompt, 404 on bad conversation id. Transcript persistence and auth_status/auth_method confirmed correct in DB.
- [ ] **Thu (Sep 24) — AI integration**: wire Gemini into stage-scoped prompts (slot extraction, intent classification, response phrasing). Server re-validates every extraction against the DB. Still no live audio.
- [ ] **Fri (Sep 25) — Demo call frontend + recording/transcript**: `/demo/call` (customer selector, mic capture, Web Speech STT, `speechSynthesis` TTS), audio upload on call end, transcript persistence. Full flow working end-to-end in-browser.
- [ ] **Sat (Sep 26) — Dashboard + polish + Twilio adapter (wired, not called)**: employee login, dashboard summary, customers/conversations list+detail with player+transcript. Write the Twilio webhook adapter (§19) and validate its request/response shape via ngrok + a manual curl — not an actual phone call.
- [ ] **Sun (Sep 27) — Real telephony verification (the only day real numbers get used)**: point the Twilio care-line webhook at the server, run a small deliberate batch of real calls to verify the full pipeline end-to-end, fix anything found (re-verifying via Demo Mode, not more real calls), final polish.

## Tech stack

See `ARCHITECTURE.md` §2 for the full table. Quick reference: Node/TS + Express + ws (server), Next.js (web, scaffolded Friday), SQLite via Node's built-in `node:sqlite` (switched from `better-sqlite3` on Tue — no VS Build Tools installed here, `node:sqlite` needs no native compile), bcryptjs for hashing, Claude (Anthropic API) for AI, Resend for email OTP, Twilio for real telephony (bolted on last).

## Repo layout

```
apps/web/       Next.js — dashboard + /demo/call + /demo/otp-console (scaffolded Fri)
apps/server/    Express + ws — state machine, AI engine, business logic, APIs
packages/db/    SQLite schema/migrations + seed script
packages/shared/ shared TS types (Customer, Conversation, Intent, AuthStage, ...)
storage/recordings/  local audio files (gitignored)
```
