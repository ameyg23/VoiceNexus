# Demo Reference

Quick-reference sheet for Voice Nexus demo/testing: logins, ZIP coverage, and intent routing codes.
Pulled live from the running database and `apps/server/src/lib/settings.ts` on 2026-09-30 — if any of
this is edited later (Settings page, a re-seed, a new signup), re-check against the live DB rather than
trusting this file blindly.

## Admin / employee logins (`/login` → ops dashboard)

| Name | Email | Password | Role |
|---|---|---|---|
| Priya Sharma | `priya.sharma@voicenexus.demo` | `admin-demo-pass` | ADMIN |
| Alex Ops | `alex@springfieldfiber.test` | `alex-demo-pass` | ADMIN |
| Marcus Lee | `marcus.lee@voicenexus.demo` | `agent-demo-pass` | AGENT |

## Customer logins

Website (`/login`) uses email + password only. Phone/call verification uses the account number (BAN)
+ 4-digit PIN only — the two credential pairs are unrelated. Website password pattern for every seeded
customer: `<firstname>-demo-pass`, lowercase. Every row below is every customer row that currently
exists in the live database, seeded or created later, not just the ones with known credentials.

| Name | Account # (BAN) | PIN | Email | Website password | Plan | Type | Status |
|---|---|---|---|---|---|---|---|
| Amara Okafor | 100001 | 4821 | `amara.okafor@example.com` | `amara-demo-pass` | Fiber 500 | Residential | Active |
| Ben Torres | 100002 | 1197 | `ben.torres@example.com` | `ben-demo-pass` | Fiber 1000 | Residential | Active, past due |
| Chidi Nwosu | 100003 | 5560 | `chidi.nwosu@example.com` | `chidi-demo-pass` | Cable Basic | Residential | Active, $0 balance |
| Dana Whitfield | 100004 | 3309 | `ameydgaikwad@gmail.com` | `dana-demo-pass` | Fiber 300 | Residential | Active — real inbox, real Email-OTP/test-email delivery works here |
| Ellis Park | 100005 | 7742 | `ellis.park@example.com` | `ellis-demo-pass` | Fiber 500 + TV | Business | **Past due** ($210.55) |
| Farrah Aziz | 100006 | 9013 | `farrah.aziz@example.com` | `farrah-demo-pass` | Cable Basic | Residential | Active, 15% discount |
| Grace Lindqvist | 100007 | 2684 | `grace.lindqvist@example.com` | `grace-demo-pass` | Fiber 1000 + TV | Residential | Active |
| Hassan Malik | 100008 | 6157 | `hassan.malik@example.com` | `hassan-demo-pass` | Fiber 300 | Business | Active, past due |
| Ines Castellano | 100009 | 8420 | `ines.castellano@example.com` | `ines-demo-pass` | Fiber 500 | Residential | Active, $0 balance |
| Jordan Lee | 100010 | *not on record* | `jordan.lee@example.com` | `jordan-demo-pass` | Starter | Residential | Active |
| Taylor Reyes | 100011 | *not on record* | `taylor.reyes@example.com` | `taylor-demo-pass` | Starter | Residential | Active |
| Rutuja | 100012 | *not on record* | `rutuja@wxample.com` | *not on record* | Fiber 300 | Residential | Active, $0 balance |
| Dhiraj | 100013 | *not on record* | `dhiraj@gmail.com` | *not on record* | Fiber 500 | Residential | Active, $25 balance |
| Amey | *(none yet — `PENDING-CUS013`)* | *(none yet)* | `amey@example.com` | *not on record* | *(none — never bought a plan)* | Residential | **Prospect** — signed up but never purchased, so not phone-reachable |

Amara (BAN 100001, PIN 4821) is the one used most often throughout this project's own testing — good
default pick if you just need one working account.

**Rows marked "not on record"**: both the website password and the phone PIN are stored as one-way
bcrypt hashes, so there's no way to recover what was originally typed for Jordan, Taylor, Rutuja, or
Dhiraj (all were real signups/purchases made directly in the app, not seeded with a known value). If you
need working credentials for any of these, say so and I'll reset that account's password/PIN to a fresh
known value and update this file — same thing already done once for Jordan/Taylor's website passwords.
"Amey" (CUS013) is a web signup that was never followed through with buying a plan, so it never got a
real BAN or PIN at all — it's stuck at the plan-picker step (`/portal/get-started`) until a plan is
purchased, or it can be ignored as leftover test data.

## ZIP code coverage (`service_areas` table)

Used by the phone flow's new-customer sign-up check and the web availability checker (`/`,
`/portal/get-started`). A ZIP not in this table reads as **not covered**, for either audience.
6-digit codes (Oct 4 — was 5-digit, migration `011_six_digit_zips.sql`).

| ZIP | Residential | Business |
|---|---|---|
| 627010 | ✅ | ✅ |
| 627020 | ✅ | ✅ |
| 627030 | ✅ | ❌ |
| 627040 | ✅ | ✅ |
| 627050 | ❌ | ✅ |
| 627060 | ❌ | ❌ |

## Intents and routing codes

Spoken on every live-agent transfer, picked by the caller's actual (first) topic — see `Settings →
Routing codes by topic` in the admin dashboard to change these. `3014` is the fallback when no specific
topic was ever captured; `3000`/`3003` are separate, used only for new-customer sign-up transfers, not
tied to an intent.

| Intent | What it does | Routing code |
|---|---|---|
| CHECK_BALANCE | Current account balance | 3020 |
| MAKE_PAYMENT | Pay the full balance (card on file) | 3021 |
| PAYMENT_HISTORY | Last payment made | 3022 |
| BILLING_DUE_DATE | Next billing due date | 3023 |
| PAYMENT_PROMISE | Promise-to-pay by a later date (≤14 days) | 3024 |
| PLAN_INFO | Current plan details | 3025 |
| PLAN_CHANGE | Switch plans (fake proration) | 3026 |
| AUTOPAY_STATUS | Whether autopay is on | 3027 |
| OUTAGE_CHECK | Known outage at the service ZIP | 3028 |
| TECH_TRIAGE | Basic troubleshooting → technician offer | 3029 |
| SCHEDULE_TECH | Book a technician visit (≤7 days) | 3030 |
| SCHEDULE_CALLBACK | Book a callback (works pre-verification too) | 3031 |
| SERVICE_AVAILABILITY | Check coverage at a different ZIP | 3032 |
| AGENT_REQUEST | Caller explicitly asks for a person | 3033 |
| *(general enquiry)* | Verification lockouts, unresolved requests, no captured topic | **3014** |
| *(new customer — residential)* | New-customer sign-up transfer | **3000** |
| *(new customer — business)* | New-customer sign-up transfer | **3003** |
