// End-to-end PRD scenario suite: drives full calls through the public call API (the same endpoints the
// demo page uses; the phone channel shares the same engine) and checks both what the caller hears and
// what lands in the database. Every change it makes (conversations, payments, plan changes, settings)
// is rolled back at the end.
//
// Run it against a server started WITHOUT a Gemini key, so every turn takes the deterministic path and
// no AI quota is spent:
//   PORT=4100 GEMINI_API_KEY= RESEND_API_KEY= DEMO_MODE=true node --import tsx src/index.ts
//   npm run test:scenarios --workspace=apps/server            (defaults to http://localhost:4100)

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.resolve(__dirname, "../../../packages/db/data/voice-nexus.sqlite"));
const BASE = (process.argv[2] ?? "http://localhost:4100").replace(/\/$/, "");
const TEST_ANI = "+15550009999";

interface Turn {
  aiText: string;
  speechText: string;
  stage: string;
  authStatus: string;
  endCall: boolean;
  transfer: boolean;
}

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        ${detail}`}`);
}

async function post(p: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

class Call {
  id = "";
  greeting = "";
  last!: Turn;
  static async start(): Promise<Call> {
    const c = new Call();
    const r = await post("/api/calls/start", { demoPhoneNumber: TEST_ANI });
    c.id = r.json.conversationId;
    c.greeting = r.json.aiText;
    c.last = r.json;
    return c;
  }
  async say(text: string): Promise<Turn> {
    const r = await post(`/api/calls/${this.id}/turn`, { text });
    if (r.status !== 200) throw new Error(`turn "${text}" → HTTP ${r.status} ${JSON.stringify(r.json)}`);
    this.last = r.json;
    return r.json;
  }
  async otp(): Promise<string> {
    const res = await fetch(`${BASE}/api/dev/otp/${this.id}`);
    return (await res.json()).code;
  }
}

const expectText = (t: Turn, re: RegExp, label: string) => check(label, re.test(t.aiText), `got: "${t.aiText}"`);
const one = (sql: string, ...params: (string | number)[]) => db.prepare(sql).get(...params) as Record<string, any> | undefined;
const balance = (id: string) => Number(one(`SELECT current_balance b FROM customers WHERE id = ?`, id)!.b);

// Drives the pre-BAN questions added for the existing/new-customer + residential/business flow,
// then the account number and PIN — the shared "get to AUTHENTICATED" path every scenario uses.
async function verifyPin(call: Call, ban: string, pin: string) {
  await call.say("existing customer");
  await call.say("residential");
  await call.say(ban);
  return call.say(pin);
}

// ---------- snapshot / restore ----------

const maxConvBefore = (one(`SELECT COALESCE(MAX(id), 'VN-000000') m FROM conversations`)!.m as string);
const customersBefore = db.prepare(`SELECT * FROM customers`).all() as Record<string, any>[];
const settingsBefore = db.prepare(`SELECT * FROM tenant_settings`).all() as Record<string, any>[];

function restore() {
  const ids = (db.prepare(`SELECT id FROM conversations WHERE id > ?`).all(maxConvBefore) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    for (const t of ["transcript_turns", "auth_sessions", "otps", "call_actions", "escalations"]) db.prepare(`DELETE FROM ${t} WHERE conversation_id = ?`).run(id);
    db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  }
  for (const c of customersBefore) {
    db.prepare(
      `UPDATE customers SET current_balance = ?, past_due_amount = ?, last_payment_amount = ?, last_payment_date = ?, plan_name = ?, mfa_method = ?, mfa_phone_number = ? WHERE id = ?`
    ).run(c.current_balance, c.past_due_amount, c.last_payment_amount, c.last_payment_date, c.plan_name, c.mfa_method, c.mfa_phone_number, c.id);
  }
  db.prepare(`DELETE FROM tenant_settings`).run();
  for (const s of settingsBefore) db.prepare(`INSERT INTO tenant_settings (key, value, updated_at) VALUES (?, ?, ?)`).run(s.key, s.value, s.updated_at);
  console.log(`\nRestored: removed ${ids.length} test conversation(s), reset customer balances/plans and settings.`);
}

function setSetting(key: string, value: unknown) {
  db.prepare(`INSERT INTO tenant_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

// ---------- scenarios ----------

async function scenarios() {
  console.log("\n1. Greeting, disclosures, pronunciation");
  {
    const call = await Call.start();
    expectText(call.last, /virtual assistant/i, "greeting discloses the AI (compliance)");
    check("recording disclosure NOT spoken by default (Sep 29 — user: 'no need of this')", !/recorded/i.test(call.last.aiText), call.last.aiText);
    await call.say("what's my balance");
    await call.say("existing customer");
    const t = await call.say("residential");
    check("pronunciation override applied to speech only", /B-A-N/.test(t.speechText) && /\bBAN\b/.test(t.aiText), `aiText="${t.aiText}" speech="${t.speechText}"`);
  }

  console.log("\n1b. Recording disclosure still works when ops explicitly re-enables it");
  {
    setSetting("recordingDisclosureEnabled", true);
    const call = await Call.start();
    expectText(call.last, /recorded/i, "greeting discloses recording when explicitly enabled");
    setSetting("recordingDisclosureEnabled", false); // restore the new default for the rest of the suite
  }

  console.log("\n2. Identity before action, goal-directed: balance asked up front is answered right after PIN");
  {
    const call = await Call.start();
    await call.say("What's my balance?");
    check("no account data before verification", !/\$\d/.test(call.last.aiText), call.last.aiText);
    const t = await verifyPin(call, "100001", "4821");
    expectText(t, /verified.*\$\d+\.\d\d/i, "verified, then balance given without re-asking");
    check("stage AUTHENTICATED", t.stage === "AUTHENTICATED", t.stage);
    const bye = await call.say("that's all, thanks");
    check("call closes immediately (CSAT off by default, Sep 29)", bye.endCall, JSON.stringify(bye));
    const after = await post(`/api/calls/${call.id}/turn`, { text: "hello?" });
    check("ended call can't be continued (409)", after.status === 409, `status ${after.status}`);
  }

  console.log("\n2b. CSAT explicitly enabled: normal rating flow, and changing their mind mid-survey to ask for a live agent");
  {
    setSetting("csatSurveyEnabled", true);

    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100001", "4821");
    const bye = await call.say("that's all, thanks");
    expectText(bye, /scale of 1 to 5/i, "CSAT survey asked when explicitly enabled");
    const done = await call.say("five");
    check("call closes after rating", done.endCall, JSON.stringify(done));
    check("CSAT stored", one(`SELECT csat_score s FROM conversations WHERE id = ?`, call.id)!.s === 5);

    const call2 = await Call.start();
    await call2.say("what's my balance");
    await verifyPin(call2, "100001", "4821");
    const bye2 = await call2.say("no thanks, that's all");
    expectText(bye2, /scale of 1 to 5/i, "CSAT survey asked at the end");
    const t2 = await call2.say("yeah, can you please transfer me to a live agent");
    check("transfers and ends instead of silently closing without a rating", t2.transfer && t2.endCall, JSON.stringify(t2));
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call2.id);
    check("escalation queued, reason CALLER_REQUESTED, caller was verified", e?.reason === "CALLER_REQUESTED" && e.verified === 1, JSON.stringify(e));
    check("no CSAT score stored (never gave one)", one(`SELECT csat_score s FROM conversations WHERE id = ?`, call2.id)!.s === null);

    setSetting("csatSurveyEnabled", false); // restore the new default for the rest of the suite
  }

  console.log("\n3. Make payment — confirm before committing (no, then yes)");
  {
    const before = balance("CUS002");
    const call = await Call.start();
    await call.say("I want to pay my bill");
    const ask = await verifyPin(call, "100002", "1197");
    expectText(ask, /charge the full \$/i, "asks for confirmation with the amount");
    const no = await call.say("no, not right now");
    expectText(no, /haven't changed anything/i, "declining charges nothing");
    check("balance unchanged after no", balance("CUS002") === before, `${balance("CUS002")} vs ${before}`);
    await call.say("actually, pay my bill");
    const yes = await call.say("yes please");
    expectText(yes, /went through/i, "payment confirmed");
    check("balance now 0", balance("CUS002") === 0, String(balance("CUS002")));
    check("PAYMENT action recorded", Boolean(one(`SELECT 1 x FROM call_actions WHERE conversation_id = ? AND type = 'PAYMENT' AND status = 'COMPLETED'`, call.id)));
  }

  console.log("\n4. Plan change — list, choose by speech, confirm");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100003", "5560");
    const list = await call.say("I want to upgrade my plan");
    expectText(list, /Fiber 1000 \+ TV for \$130/i, "lists plans with prices");
    const confirm = await call.say("the one gig plan with TV");
    expectText(confirm, /switch you from .* to Fiber 1000 \+ TV/i, "restates the change before committing");
    expectText(confirm, /adds \$85\.00 to your balance/i, "upgrade charge (Cable Basic $45 -> Fiber 1000+TV $130) previewed before confirming");
    const done = await call.say("yes");
    expectText(done, /now on Fiber 1000 \+ TV/i, "plan changed");
    expectText(done, /added \$85\.00 to your balance, which is now \$85\.00/i, "upgrade charge actually applied, fake proration (Sep 30)");
    check("plan updated in DB", one(`SELECT plan_name p FROM customers WHERE id = 'CUS003'`)!.p === "Fiber 1000 + TV");
    check("balance charged the price difference in DB", one(`SELECT current_balance b FROM customers WHERE id = 'CUS003'`)!.b === 85);
  }

  console.log("\n4b. Plan choice with a negation in it; 'no' after 'anything else' ends politely");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100001", "4821");
    await call.say("what other plans do you have");
    const confirm = await call.say("the fastest one you have, but I don't need television");
    expectText(confirm, /to Fiber 1000 at \$90/i, "picks Fiber 1000 without TV (not treated as 'no')");
    const keep = await call.say("no");
    expectText(keep, /haven't changed anything.*anything else/i, "declining the switch keeps the plan");
    const done = await call.say("hmm, actually no, leave it as it is");
    check("'no' after 'anything else?' closes the call immediately (CSAT off by default)", done.endCall, JSON.stringify(done));
  }

  console.log("\n5. Cancel mid-subflow");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100003", "5560");
    await call.say("switch my plan");
    const c = await call.say("never mind");
    expectText(c, /haven't changed anything/i, "cancel leaves the account untouched");
  }

  console.log("\n6. Payment promise — date parsing, range check, confirmation");
  {
    const call = await Call.start();
    await call.say("I need more time to pay");
    const ask = await verifyPin(call, "100001", "4821");
    expectText(ask, /what date can you pay by/i, "asks for a date");
    const far = await call.say("the 1st of december");
    expectText(far, /only set an arrangement up to/i, "rejects a date beyond 14 days");
    const confirm = await call.say("friday");
    expectText(confirm, /by (Friday|\w+day), /i, "reads the resolved date back");
    const done = await call.say("yes");
    expectText(done, /noted your arrangement/i, "promise logged");
    check("PAYMENT_PROMISE action scheduled", Boolean(one(`SELECT 1 x FROM call_actions WHERE conversation_id = ? AND type = 'PAYMENT_PROMISE' AND scheduled_for IS NOT NULL`, call.id)));
  }

  console.log("\n7. Outage check in the outage ZIP");
  {
    const call = await Call.start();
    await call.say("my internet isn't working");
    await call.say("existing customer");
    await call.say("residential");
    await call.say("100008");
    const t = await call.say("6157");
    expectText(t, /known outage in your area.*6 PM/i, "outage reported instead of troubleshooting");
  }

  console.log("\n7b. MFA removed entirely (user decision, Sep 29: 'we are not doing MFA'): a customer seeded with EMAIL mfa_method still just verifies by PIN, no MFA prompt at all");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await call.say("existing customer");
    await call.say("residential");
    const t = await call.say("100004");
    expectText(t, /4-digit PIN/i, "asks for the PIN directly - no phone-enrollment offer, no email-OTP question");
    const verified = await call.say("3309");
    expectText(verified, /verified/i, "PIN verifies a customer whose account is still seeded with EMAIL mfa_method");
    check("mfa fields on the account are untouched, just unused", one(`SELECT mfa_method m FROM customers WHERE id = 'CUS004'`)!.m === "EMAIL");
  }

  console.log("\n8. Tech triage → technician visit (dispatch request)");
  {
    const call = await Call.start();
    await call.say("my wifi keeps dropping");
    const t = await verifyPin(call, "100001", "4821");
    expectText(t, /unplug.*technician visit/i, "troubleshooting steps, then offers a technician");
    const day = await call.say("yes");
    expectText(day, /what day works/i, "asks for a day");
    const confirm = await call.say("tomorrow morning");
    expectText(confirm, /technician for .* morning/i, "confirms day + window");
    const booked = await call.say("yes");
    expectText(booked, /booked/i, "visit booked");
    check("TECH_VISIT action scheduled", Boolean(one(`SELECT 1 x FROM call_actions WHERE conversation_id = ? AND type = 'TECH_VISIT'`, call.id)));
  }

  console.log("\n9. Callback before verification (VN-8)");
  {
    const call = await Call.start();
    const ask = await call.say("can someone call me back");
    expectText(ask, /when would you like us to call/i, "asks when");
    const confirm = await call.say("tomorrow afternoon");
    expectText(confirm, /ending in 9 9 9 9/i, "confirms the caller's number and time");
    const done = await call.say("yes");
    check("call ends after booking", done.endCall);
    check("CALLBACK action recorded without account access", Boolean(one(`SELECT 1 x FROM call_actions WHERE conversation_id = ? AND type = 'CALLBACK' AND customer_id IS NULL`, call.id)));
  }

  console.log("\n9b. Callback with the time in the first sentence");
  {
    const call = await Call.start();
    const confirm = await call.say("can someone call me back tomorrow afternoon");
    expectText(confirm, /ending in 9 9 9 9 on .* afternoon/i, "skips 'when?' and confirms the time straight away");
  }

  console.log("\n10. Agent request mid-verification → structured, unverified handoff (VN-5)");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await call.say("existing customer");
    await call.say("residential");
    await call.say("100002");
    const t = await call.say("I want to talk to a representative");
    check("transfers and ends", t.transfer && t.endCall, JSON.stringify(t));
    expectText(t, /agent will verify your identity/i, "tells the caller identity isn't verified yet");
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check("escalation queued as WAITING, reason CALLER_REQUESTED, not verified", e?.status === "WAITING" && e.reason === "CALLER_REQUESTED" && e.verified === 0, JSON.stringify(e));
    check("handoff summary names the caller and intent", /Ben Torres.*NOT verified.*balance/i.test(String(e?.summary)), String(e?.summary));
  }

  console.log("\n11. Honest limits: repeated misunderstanding → offer agent or callback → verified handoff");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100001", "4821");
    const first = await call.say("purple elephants");
    expectText(first, /didn't quite catch that.*tell me again/i, "first miss: plain re-prompt, no recited menu");
    const second = await call.say("banana hammock");
    expectText(second, /transfer you to a live agent now, or have someone call you back/i, "second miss: offers agent or callback");
    const t = await call.say("an agent please");
    check("transfers", t.transfer && t.endCall);
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check("verified handoff with attempted steps", e?.verified === 1 && /Identity verified by PIN/.test(String(e?.attempted)), JSON.stringify(e));
  }

  console.log("\n12. IVR menu fallback (degraded mode): keypad digit");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100001", "4821");
    const t = await call.say("1");
    expectText(t, /balance is \$/i, "'1' → balance");
  }

  console.log("\n13. PIN lockout → verification-failed handoff");
  {
    const call = await Call.start();
    await call.say("balance");
    await call.say("existing customer");
    await call.say("residential");
    await call.say("100001");
    await call.say("1111");
    await call.say("2222");
    const t = await call.say("3333");
    check("third wrong PIN transfers", t.transfer && t.stage === "FAILED", JSON.stringify(t));
    check("escalation reason PIN_LOCKOUT", one(`SELECT reason r FROM escalations WHERE conversation_id = ?`, call.id)?.r === "PIN_LOCKOUT");
  }

  console.log("\n14. Operator settings: disabled intent, greeting change");
  {
    setSetting("intentOverrides", { PLAN_CHANGE: { enabled: false, examples: [] } });
    setSetting("greetingPrompt", "Hello from {brand}! {disclosures} How may I help?");
    const call = await Call.start();
    expectText(call.last, /^Hello from Springfield Fiber!.*virtual assistant.*How may I help\?$/, "custom greeting with disclosures filled in");
    await call.say("what's my balance");
    await verifyPin(call, "100003", "5560");
    const t = await call.say("I want to upgrade my plan");
    expectText(t, /only help with things related to your .* account or service.*live agent/i, "disabled intent: honest limit + escalation offer");
    // Restore before later scenarios (21/22 exercise PLAN_CHANGE again) — this was silently relying on
    // restore()'s end-of-run settings reset before, which happened to work only because nothing after
    // #14 needed PLAN_CHANGE enabled; found while adding scenario 22.
    setSetting("intentOverrides", { PLAN_CHANGE: { enabled: true, examples: [] } });
  }

  console.log("\n15. Ops dashboard APIs over the calls above (employee session)");
  {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "priya.sharma@voicenexus.demo", password: "admin-demo-pass" }),
    });
    // Login clears the other session type too, so pick the employee cookie out of the Set-Cookie list.
    const cookie = (login.headers.getSetCookie().find((c) => c.startsWith("vn_employee_session=")) ?? "").split(";")[0];
    check("admin login", login.status === 200 && cookie.startsWith("vn_employee_session="), `status ${login.status}`);
    const api = async (p: string, init: RequestInit = {}) => {
      const res = await fetch(`${BASE}${p}`, { ...init, headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };

    const summary = (await api("/api/dashboard/summary")).json;
    check("KPIs computed", summary.transferRate !== null && summary.callback >= 1 && summary.csatResponses >= 1 && summary.costPerCall !== null, JSON.stringify(summary).slice(0, 300));
    check("reply latency tracked", summary.latency.turns > 0 && summary.latency.medianMs !== null, JSON.stringify(summary.latency));

    const reports = (await api("/api/dashboard/reports?tzOffset=-330")).json;
    check("reports include escalation reasons from handoffs", reports.escalationReasons.some((r: any) => r.reason === "CALLER_REQUESTED"), JSON.stringify(reports.escalationReasons));
    check("CSAT distribution", reports.csatDistribution.find((c: any) => c.score === 5)?.count >= 1, JSON.stringify(reports.csatDistribution));

    const open = (await api("/api/escalations?status=OPEN")).json.escalations as any[];
    check("escalation queue lists waiting handoffs", open.length >= 3 && open.every((e) => e.status === "WAITING"), `${open.length} open`);
    const target = open[0];
    const accepted = await api(`/api/escalations/${target.id}/accept`, { method: "POST", body: "{}" });
    check("accept handoff", accepted.status === 200 && accepted.json.escalation.acceptedByName === "Priya Sharma", JSON.stringify(accepted.json));
    const again = await api(`/api/escalations/${target.id}/accept`, { method: "POST", body: "{}" });
    check("can't accept twice (409)", again.status === 409, `status ${again.status}`);
    const resolved = await api(`/api/escalations/${target.id}/resolve`, { method: "POST", body: JSON.stringify({ notes: "Verified by phone, balance explained" }) });
    check("resolve handoff with notes", resolved.status === 200 && resolved.json.escalation.status === "RESOLVED", JSON.stringify(resolved.json));

    const callbacks = (await api("/api/actions?type=CALLBACK&status=SCHEDULED")).json.actions as any[];
    check("callback appears in follow-ups", callbacks.length >= 1 && /call back|callback/i.test(callbacks[0].description), JSON.stringify(callbacks[0]));
    const done = await api(`/api/actions/${callbacks[0].id}/status`, { method: "POST", body: JSON.stringify({ status: "DONE" }) });
    check("mark callback done", done.status === 200 && done.json.action.status === "DONE", JSON.stringify(done.json));

    const detail = (await api(`/api/conversations/${open.find((e) => e.reason === "UNRESOLVED_REQUEST")?.conversationId ?? target.conversationId}`)).json;
    check("call detail carries escalation + latency", Boolean(detail.escalation) && detail.turns.some((t: any) => t.latencyMs !== null), Object.keys(detail).join(","));

    const bad = await api("/api/settings", { method: "PUT", body: JSON.stringify({ agentTransferNumber: "call bob", unknownTurnsBeforeEscalation: 99 }) });
    check("settings validation rejects bad values", bad.status === 400 && bad.json.error.fieldErrors.agentTransferNumber && bad.json.error.fieldErrors.unknownTurnsBeforeEscalation, JSON.stringify(bad.json));
    const good = await api("/api/settings", { method: "PUT", body: JSON.stringify({ assistantName: "Nova" }) });
    check("settings save + greeting preview", good.status === 200 && /Nova/.test(good.json.preview.greeting), JSON.stringify(good.json?.preview));
    const anon = await fetch(`${BASE}/api/settings`);
    check("settings require an employee session", anon.status === 401, `status ${anon.status}`);
  }

  console.log("\n16. Unknown account number → 3-attempt lockout → routed by the caller's stated topic");
  {
    const call = await Call.start();
    await call.say("what's my due date");
    await call.say("existing customer");
    await call.say("residential");
    const first = await call.say("999999");
    expectText(first, /wasn't able to find an account.*2 attempts left.*correct account number/i, "first miss: 2 attempts left");
    const second = await call.say("999998");
    expectText(second, /wasn't able to find an account.*1 attempt left.*correct account number/i, "second miss: 1 attempt left (singular)");
    const third = await call.say("999997");
    check("third miss transfers and marks the session FAILED", third.transfer && third.stage === "FAILED", JSON.stringify(third));
    // Routed by BILLING_DUE_DATE's own code (3023), not the shared general-enquiry one (3014) —
    // the caller stated a real topic before the lockout, so per-intent routing applies even here.
    expectText(
      third,
      /transferring you regarding your billing due date to agent 3 0 2 3/i,
      "speaks BILLING_DUE_DATE's own routing code AND names the topic, not just the generic one"
    );
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check(
      "escalation reason BAN_LOOKUP_FAILED with the per-intent routing code logged",
      e?.reason === "BAN_LOOKUP_FAILED" && e.intent === "BILLING_DUE_DATE" && e.routing_code === "3023",
      JSON.stringify(e)
    );
  }

  console.log("\n16b. Same lockout, but no real topic was ever stated → falls back to the general-enquiry code");
  {
    const call = await Call.start();
    await call.say("purple elephants"); // 1st unclear: re-prompted, still AWAITING_INTENT
    await call.say("banana hammock"); // 2nd unclear: retry limit hit, moves on with detected_intent = UNKNOWN
    await call.say("existing customer");
    await call.say("residential");
    await call.say("999999");
    await call.say("999998");
    const third = await call.say("999997");
    expectText(third, /transferring you to agent 3 0 1 4/i, "no real intent captured, falls back to the general-enquiry code");
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check("escalation routing code falls back correctly", e?.routing_code === "3014", JSON.stringify(e));
  }

  console.log("\n17. New customer, residential — service available → transfer to sign up");
  {
    const call = await Call.start();
    await call.say("is service available in my area");
    await call.say("new customer");
    await call.say("residential");
    const zipReply = await call.say("62701");
    expectText(zipReply, /available in 62701.*transfer you to get signed up/i, "confirms coverage and offers a transfer");
    const t = await call.say("yes");
    check("transfers to sign-up", t.transfer && t.endCall, JSON.stringify(t));
    expectText(t, /reference code is 3 0 0 0/i, "speaks the new-customer residential code");
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check("escalation reason NEW_CUSTOMER_ENROLLMENT, no customer identified", e?.reason === "NEW_CUSTOMER_ENROLLMENT" && e.customer_id === null, JSON.stringify(e));
  }

  console.log("\n18. New customer, business — not covered yet → polite close, no transfer");
  {
    const call = await Call.start();
    await call.say("do you serve my area");
    await call.say("new customer");
    await call.say("business");
    const zipReply = await call.say("62706");
    check("call ends without a transfer", zipReply.endCall === true && !zipReply.transfer, JSON.stringify(zipReply));
    expectText(zipReply, /isn't available in 62706 yet/i, "tells the caller service isn't available there");
    check("no escalation logged", !one(`SELECT 1 x FROM escalations WHERE conversation_id = ?`, call.id));
  }

  console.log("\n19. Multi-account: verified caller switches to a different account mid-call");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, "100001", "4821"); // Amara Okafor
    const balanceReply = call.last;
    expectText(balanceReply, /verified.*balance is/i, "answers for the first account");
    const switchReply = await call.say("sorry, wrong account — I want to ask about a different account");
    expectText(switchReply, /what's the other account number/i, "re-prompts for a new account number, still mid-call");
    check("not re-asked existing/new or residential/business", switchReply.stage === "AWAITING_BAN", JSON.stringify(switchReply));
    await call.say("100002"); // Ben Torres — straight to BAN, no repeat of the existing/new or residential/business questions
    const second = await call.say("1197");
    expectText(second, /verified.*balance is/i, "authenticates and answers for the second account");
    check("conversation now attributed to the second customer", one(`SELECT customer_id FROM conversations WHERE id = ?`, call.id)?.customer_id === "CUS002");
  }

  console.log("\n20. Web signup doesn't make you a customer until you buy a plan (Sep 30)");
  {
    const email = `prospect-${Date.now()}@example.com`;
    const signupRes = await fetch(`${BASE}/api/auth/customer/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Prospect", email, password: "prospect-test-pass" }),
    });
    const signupJson = await signupRes.json();
    check("signup succeeds without a PIN", signupRes.status === 201, JSON.stringify(signupJson));
    check(
      "starts as PROSPECT with a non-phone-reachable sentinel BAN",
      signupJson.customer.accountStatus === "PROSPECT" && signupJson.customer.ban.startsWith("PENDING-"),
      JSON.stringify(signupJson)
    );

    const cookie = (signupRes.headers.getSetCookie().find((c) => c.startsWith("vn_customer_session=")) ?? "").split(";")[0];
    const api = async (p: string, init: RequestInit = {}) => {
      const res = await fetch(`${BASE}${p}`, { ...init, headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };

    const session = await api("/api/auth/session");
    check("session redirect points at get-started, not the account page", session.json.redirectTo === "/portal/get-started", JSON.stringify(session.json));

    const purchase = await api("/api/auth/customer/purchase-plan", { method: "POST", body: JSON.stringify({ planName: "Fiber 300" }) });
    check(
      "purchase assigns a real BAN + a 4-digit PIN",
      purchase.status === 201 && /^BAN\d+$/.test(purchase.json.ban) && /^\d{4}$/.test(purchase.json.pin),
      JSON.stringify(purchase.json)
    );

    const sessionAfter = await api("/api/auth/session");
    check("session now redirects to the normal account page", sessionAfter.json.redirectTo === "/portal/account", JSON.stringify(sessionAfter.json));

    const doublePurchase = await api("/api/auth/customer/purchase-plan", { method: "POST", body: JSON.stringify({ planName: "Fiber 1000" }) });
    check("can't buy a second plan once active", doublePurchase.status === 400, JSON.stringify(doublePurchase.json));

    const call = await Call.start();
    await call.say("what's my balance");
    const t = await verifyPin(call, purchase.json.ban.replace("BAN", ""), purchase.json.pin);
    expectText(t, /verified.*balance is \$0\.00/i, "the newly-assigned BAN+PIN verifies on a real call");

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "priya.sharma@voicenexus.demo", password: "admin-demo-pass" }),
    });
    const adminCookie = (login.headers.getSetCookie().find((c) => c.startsWith("vn_employee_session=")) ?? "").split(";")[0];
    const custList = await fetch(`${BASE}/api/customers`, { headers: { cookie: adminCookie } }).then((r) => r.json());
    check("the purchased customer appears in the ops list", custList.customers.some((c: { email: string }) => c.email === email), JSON.stringify(custList.customers.length));

    const email2 = `prospect2-${Date.now()}@example.com`;
    await fetch(`${BASE}/api/auth/customer/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Never Buys", email: email2, password: "prospect-test-pass" }),
    });
    const custList2 = await fetch(`${BASE}/api/customers`, { headers: { cookie: adminCookie } }).then((r) => r.json());
    check(
      "a prospect who never bought a plan is excluded from the ops list",
      !custList2.customers.some((c: { email: string }) => c.email === email2),
      JSON.stringify(custList2.customers.length)
    );

    // Delete this scenario's own conversation first (FK: conversations.customer_id → customers.id) —
    // the shared restore() below only clears conversations, not customer rows this scenario created.
    for (const t of ["transcript_turns", "auth_sessions", "otps", "call_actions", "escalations"]) db.prepare(`DELETE FROM ${t} WHERE conversation_id = ?`).run(call.id);
    db.prepare(`DELETE FROM conversations WHERE id = ?`).run(call.id);
    db.prepare(`DELETE FROM customers WHERE email = @e1 OR email = @e2`).run({ "@e1": email, "@e2": email2 });
  }

  console.log("\n21. Pre-auth 'what plans do you have' — answered with no account, then the sign-up flow resumes exactly where it left off (Sep 30)");
  {
    const call = await Call.start();
    await call.say("what's my balance");
    const plans = await call.say("actually, can you tell me about your plans and services first");
    expectText(plans, /internet plans/i, "answers the plan catalog, no account needed");
    expectText(plans, /business/i, "mentions business plans too, not residential-only");
    expectText(plans, /billing and payments/i, "also summarizes what the assistant can help with");
    expectText(plans, /existing springfield fiber customer, or a new customer/i, "resumes exactly where the flow left off");
    const t = await verifyPin(call, "100001", "4821");
    expectText(t, /verified.*\$\d+\.\d\d/i, "the flow continues normally afterward, unaffected by the aside");
  }

  console.log("\n22. Web purchase of a business plan tags the account BUSINESS, and phone plan-change stays business-scoped (Sep 30)");
  {
    const email = `biz-prospect-${Date.now()}@example.com`;
    const signupRes = await fetch(`${BASE}/api/auth/customer/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Biz Prospect", email, password: "biz-test-pass" }),
    });
    const cookie = (signupRes.headers.getSetCookie().find((c) => c.startsWith("vn_customer_session=")) ?? "").split(";")[0];
    const api = async (p: string, init: RequestInit = {}) => {
      const res = await fetch(`${BASE}${p}`, { ...init, headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };

    const plansRes = await api("/api/auth/customer/plans");
    check(
      "the plans catalog offers both residential and business tiers",
      plansRes.json.plans.some((p: { audience: string }) => p.audience === "RESIDENTIAL") && plansRes.json.plans.some((p: { audience: string }) => p.audience === "BUSINESS"),
      JSON.stringify(plansRes.json.plans.map((p: { name: string }) => p.name))
    );

    const purchase = await api("/api/auth/customer/purchase-plan", { method: "POST", body: JSON.stringify({ planName: "Business 500" }) });
    check("purchase succeeds on a business plan", purchase.status === 201, JSON.stringify(purchase.json));

    const custId = one(`SELECT id id FROM customers WHERE email = ?`, email)!.id as string;
    check(
      "customer_type set to BUSINESS from the plan actually bought, not left at the RESIDENTIAL column default",
      one(`SELECT customer_type t FROM customers WHERE id = ?`, custId)!.t === "BUSINESS"
    );

    const call = await Call.start();
    await call.say("what's my balance");
    await verifyPin(call, purchase.json.ban.replace("BAN", ""), purchase.json.pin);
    const list = await call.say("what other plans do you have");
    expectText(list, /Business 300|Business 1000/i, "lists other business plans");
    check("never lists residential plans to a business account", !/\bFiber \d/i.test(list.aiText), list.aiText);

    for (const t of ["transcript_turns", "auth_sessions", "otps", "call_actions", "escalations"]) db.prepare(`DELETE FROM ${t} WHERE conversation_id = ?`).run(call.id);
    db.prepare(`DELETE FROM conversations WHERE id = ?`).run(call.id);
    db.prepare(`DELETE FROM customers WHERE email = @e`).run({ "@e": email });
  }

  console.log("\n23. Public homepage endpoints - no session needed, and signup+purchase in one step (Sep 30)");
  {
    const plansRes = await fetch(`${BASE}/api/demo/plans`);
    const plansJson = await plansRes.json();
    check("GET /api/demo/plans needs no auth and returns the full catalog", plansRes.status === 200 && plansJson.plans.length === 10, JSON.stringify(plansJson).slice(0, 200));

    const availRes = await fetch(`${BASE}/api/demo/service-availability?zip=62701&accountType=RESIDENTIAL`);
    const availJson = await availRes.json();
    check("GET /api/demo/service-availability needs no auth and matches the phone flow's own lookup", availRes.status === 200 && availJson.available === true, JSON.stringify(availJson));

    // The public homepage's "click a plan -> /signup?plan=X -> account created and purchased in one
    // step" flow (user request, Sep 30: "instead of a sign up page, once they click on any
    // plans/packages/services while purchasing it we will get their details").
    const email = `homepage-buyer-${Date.now()}@example.com`;
    const signupRes = await fetch(`${BASE}/api/auth/customer/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Homepage Buyer", email, password: "homepage-test-pass" }),
    });
    const cookie = (signupRes.headers.getSetCookie().find((c) => c.startsWith("vn_customer_session=")) ?? "").split(";")[0];
    const purchase = await fetch(`${BASE}/api/auth/customer/purchase-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ planName: "Fiber 300" }),
    });
    const purchaseJson = await purchase.json();
    check("signup immediately followed by purchase-plan (same session) activates the account", purchase.status === 201 && /^BAN\d+$/.test(purchaseJson.ban), JSON.stringify(purchaseJson));
    check("customer_type set from the plan bought", one(`SELECT customer_type t FROM customers WHERE email = ?`, email)!.t === "RESIDENTIAL");

    db.prepare(`DELETE FROM customers WHERE email = @e`).run({ "@e": email });
  }

  console.log("\n24. Self-service web plan switch - no re-auth, fake proration (Sep 30)");
  {
    const email = `switcher-${Date.now()}@example.com`;
    const signupRes = await fetch(`${BASE}/api/auth/customer/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Plan Switcher", email, password: "switch-test-pass" }),
    });
    const cookie = (signupRes.headers.getSetCookie().find((c) => c.startsWith("vn_customer_session=")) ?? "").split(";")[0];
    const api = async (p: string, init: RequestInit = {}) => {
      const res = await fetch(`${BASE}${p}`, { ...init, headers: { "Content-Type": "application/json", cookie, ...(init.headers ?? {}) } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };

    await api("/api/auth/customer/purchase-plan", { method: "POST", body: JSON.stringify({ planName: "Fiber 300" }) }); // $55, balance starts at $0

    // Same cookie the whole way through - no login/signup call in between - proves "no re-auth needed".
    const upgrade = await api("/api/auth/customer/switch-plan", { method: "POST", body: JSON.stringify({ planName: "Fiber 1000" }) }); // $90, +$35
    check("upgrade succeeds on the same session, no re-login", upgrade.status === 200 && upgrade.json.charged === 35 && upgrade.json.newBalance === 35, JSON.stringify(upgrade.json));
    check("balance actually charged in the DB", one(`SELECT current_balance b FROM customers WHERE email = ?`, email)!.b === 35);

    const downgrade = await api("/api/auth/customer/switch-plan", { method: "POST", body: JSON.stringify({ planName: "Fiber 300" }) }); // $55, no charge on a downgrade
    check("downgrade adds no charge, balance untouched", downgrade.status === 200 && downgrade.json.charged === 0 && downgrade.json.newBalance === 35, JSON.stringify(downgrade.json));

    const wrongAudience = await api("/api/auth/customer/switch-plan", { method: "POST", body: JSON.stringify({ planName: "Business 500" }) });
    check("can't switch to a plan from the other audience", wrongAudience.status === 400, JSON.stringify(wrongAudience.json));

    const samePlan = await api("/api/auth/customer/switch-plan", { method: "POST", body: JSON.stringify({ planName: "Fiber 300" }) });
    check("can't 'switch' to the plan already on", samePlan.status === 400, JSON.stringify(samePlan.json));

    // customer_events (migration 008) references customers - delete the switch-plan events it
    // logged first, or this FK-violates the same way scenario 20's cleanup once did for conversations.
    db.prepare(`DELETE FROM customer_events WHERE customer_id = (SELECT id FROM customers WHERE email = @e)`).run({ "@e": email });
    db.prepare(`DELETE FROM customers WHERE email = @e`).run({ "@e": email });
  }

  console.log("\n25. Persistent 'just transfer me' at the opening: two offers to help first, then verifies before transferring, intent left unidentified (Sep 30)");
  {
    const call = await Call.start();
    const first = await call.say("agent");
    check("1st ask: offers to help instead of transferring", !first.transfer && !first.endCall, JSON.stringify(first));
    expectText(first, /let me know what you need.*might be able to help/i, "pushback wording");

    const second = await call.say("I need customer support");
    check("2nd ask ('customer support' also counts): offers again, still no transfer", !second.transfer && !second.endCall, JSON.stringify(second));

    const third = await call.say("just give me a live agent");
    check("3rd ask: moves into verification instead of transferring unverified", !third.transfer && !third.endCall, JSON.stringify(third));
    expectText(third, /existing Springfield Fiber customer, or a new customer/i, "starts identity verification");

    const insistAgain = await call.say("agent");
    check("asking again mid-verification doesn't restart or short-circuit it", !insistAgain.transfer && !insistAgain.endCall, JSON.stringify(insistAgain));
    expectText(insistAgain, /connected with an agent as soon as we're done here/i, "reminded, then steered back to the pending question");

    const final = await verifyPin(call, "100003", "5560");
    check("transfers once verified", final.transfer && final.endCall && final.authStatus === "SUCCESS", JSON.stringify(final));
    expectText(final, /Thanks, you're verified\..*Transferring you to agent/i, "verified first, then transferred");
    const c = one(`SELECT detected_intent FROM conversations WHERE id = ?`, call.id);
    check("intent left unidentified - no reason was ever stated", c?.detected_intent === null, JSON.stringify(c));
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check(
      "escalation verified, reason CALLER_REQUESTED, general-enquiry routing code (no topic to route by)",
      e?.verified === 1 && e.reason === "CALLER_REQUESTED" && e.intent === null && e.routing_code === "3014",
      JSON.stringify(e)
    );
  }

  console.log("\n26. Caller can't recall their account number or PIN → asked for a ZIP instead, then handed to an agent (Sep 30)");
  {
    // Forgets the account number itself: never gets as far as AWAITING_PIN.
    const call = await Call.start();
    await call.say("what's my balance");
    await call.say("existing customer");
    await call.say("residential");
    const asked = await call.say("I don't remember my account number");
    check("asks for a ZIP instead of retrying, no transfer yet", !asked.transfer && !asked.endCall, JSON.stringify(asked));
    expectText(asked, /zip code for your service address/i, "ZIP prompt");
    const badZip = await call.say("somewhere in Springfield");
    expectText(badZip, /didn't catch a zip code/i, "still needs 5 digits");
    const final = await call.say("62701");
    check("transfers once the ZIP is given", final.transfer && final.endCall && final.authStatus !== "SUCCESS", JSON.stringify(final));
    expectText(final, /wasn't able to verify your account.*transfer you to a live agent/i, "unverified handoff wording");
    const conv = one(`SELECT zip_provided FROM conversations WHERE id = ?`, call.id);
    check("ZIP recorded on the conversation", conv?.zip_provided === "62701", JSON.stringify(conv));
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check(
      "escalation reason CREDENTIALS_FORGOTTEN, unverified, routed by the stated topic, ZIP in the attempted list",
      e?.reason === "CREDENTIALS_FORGOTTEN" && e.verified === 0 && e.intent === "CHECK_BALANCE" && e.routing_code === "3020" && /gave ZIP code 62701/i.test(String(e?.attempted)),
      JSON.stringify(e)
    );
  }

  console.log("\n26b. Forgets the PIN specifically, after already giving a valid account number");
  {
    const call = await Call.start();
    await call.say("I want to check my balance"); // a real opening request, same as every other scenario - "existing customer" said as the very first turn (still AWAITING_INTENT) reads as UNKNOWN, not a customer-kind answer
    await call.say("existing customer");
    await call.say("residential");
    await call.say("100001"); // Amara Okafor - found fine, PIN is the problem
    const asked = await call.say("I've forgotten my PIN");
    check("asks for a ZIP instead of retrying the PIN", !asked.transfer && !asked.endCall, JSON.stringify(asked));
    expectText(asked, /zip code for your service address/i, "ZIP prompt");
    const final = await call.say("62701");
    check("transfers unverified", final.transfer && final.endCall && final.authStatus !== "SUCCESS", JSON.stringify(final));
    const e = one(`SELECT * FROM escalations WHERE conversation_id = ?`, call.id);
    check("escalation reason CREDENTIALS_FORGOTTEN, account number already on record", e?.reason === "CREDENTIALS_FORGOTTEN" && /gave account number BAN100001/i.test(String(e?.attempted)), JSON.stringify(e));
  }
}

try {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (!health.demoMode) throw new Error("server must run with DEMO_MODE=true (OTP scenarios read the dev OTP endpoint)");
  await scenarios();
} catch (err) {
  failures++;
  console.error("\nScenario run aborted:", err);
} finally {
  restore();
  console.log(`\n${passes} passed, ${failures} failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
