// The conversation engine. Two layers:
//   1. `stage` — the deterministic Auth State Machine (ARCHITECTURE.md §17): AWAITING_INTENT →
//      AWAITING_BAN → AWAITING_PIN / AWAITING_OTP → AUTHENTICATED (or FAILED). Nothing touches account
//      data until the server itself has moved the stage to AUTHENTICATED.
//   2. `subflow` — a goal-directed multi-turn task inside a stage (PRD VN-2/VN-4): confirm a payment,
//      pick a new plan, set a payment date, book a technician, book a callback, answer the CSAT survey.
//      Irreversible actions only execute after an explicit "yes" ("Confirm before committing").
// The AI only reads language in and phrases language out; every decision here is code.

import { db } from "@voice-nexus/db";
import type { AuthStage, CustomerType, EscalationReason, Intent } from "@voice-nexus/shared";
import {
  extractBan,
  extractPin,
  extractOtp,
  extractZip,
  parseCustomerKind,
  parseAccountType,
  SWITCH_ACCOUNT_RE,
  classifyIntent,
  parseYesNo,
  isCancel,
  extractDate,
  extractPlan,
  extractRating,
} from "./extraction.js";
import {
  findCustomerByBan,
  findCustomerById,
  verifyPin,
  getIntentResponseData,
  PLAN_CATALOG,
  findPlan,
  applyPlanChange,
  applyPayment,
  findActiveOutage,
  isServiceAvailable,
  type CustomerRow,
} from "./businessLogic.js";
import { issueOtp, verifyOtp, getDevOtp } from "./otpService.js";
import { phraseResponseAI, translateAI, type VoiceStyle } from "./aiEngine.js";
import { getSettings, fillTemplate, isIntentEnabled, routingCodeForIntent, LANGUAGE_NAMES, type TenantSettings } from "./settings.js";
import { recordAction } from "./actions.js";
import { createEscalation } from "./escalations.js";
import { WINDOW_LABELS, addDays, daysBetween, fromIsoDate, parseSpokenDate, parseWindow, speakDate, toIsoDate, todayLocal, type TimeWindow } from "./dates.js";

const PIN_MAX_ATTEMPTS = 3;
const BAN_MAX_ATTEMPTS = 3;
const PROMISE_MAX_DAYS = 14;
const TECH_MAX_DAYS = 7;
const CALLBACK_MAX_DAYS = 7;
const ANYTHING_ELSE = "Is there anything else I can help you with?";
// One retry before giving up on classifying the caller's opening request and moving on to
// identifying them anyway ("if not clear, ask again; once clear, proceed").
const INTENT_RETRY_LIMIT = 1;

type Subflow =
  | { type: "CUSTOMER_KIND" }
  | { type: "ACCOUNT_TYPE"; forNew: boolean }
  | { type: "NEW_CUSTOMER_ZIP"; accountType: CustomerType }
  | { type: "NEW_CUSTOMER_OFFER"; accountType: CustomerType }
  | { type: "EXISTING_SERVICE_ZIP" }
  | { type: "CONFIRM_BAN"; ban: string }
  | { type: "CONFIRM_PIN"; pin: string }
  | { type: "CONFIRM_PAYMENT"; amount: number }
  | { type: "PLAN_CHANGE"; step: "CHOOSE" }
  | { type: "PLAN_CHANGE"; step: "CONFIRM"; plan: string }
  | { type: "PAYMENT_PROMISE"; step: "DATE"; amount: number }
  | { type: "PAYMENT_PROMISE"; step: "CONFIRM"; amount: number; date: string }
  | { type: "TECH_VISIT"; step: "OFFER" }
  | { type: "TECH_VISIT"; step: "DATE" }
  | { type: "TECH_VISIT"; step: "WINDOW"; date: string }
  | { type: "TECH_VISIT"; step: "CONFIRM"; date: string; window: TimeWindow }
  | { type: "CALLBACK"; step: "TIME" }
  | { type: "CALLBACK"; step: "WINDOW"; date: string }
  | { type: "CALLBACK"; step: "CONFIRM"; date: string; window: TimeWindow }
  | { type: "ESCALATION_OFFER" }
  | { type: "CSAT" };

interface AuthSessionRow {
  conversation_id: string;
  stage: AuthStage;
  customer_id: string | null;
  pin_attempts: number;
  ban_attempts: number;
  authenticated_at: string | null;
  subflow: string | null;
  unknown_streak: number;
}

export interface TurnResult {
  aiText: string;
  stage: AuthStage;
  authStatus: "PENDING" | "SUCCESS" | "FAILED";
  // True when the conversation is over (goodbye, handoff, callback booked before verification).
  endCall?: boolean;
  // True when the caller is being handed to a live agent (phone channel dials the agent line if set).
  transfer?: boolean;
}

interface Ctx {
  conversationId: string;
  session: AuthSessionRow;
  settings: TenantSettings;
  utterance: string;
}

// ---------- session helpers ----------

function loadSession(conversationId: string): AuthSessionRow {
  const row = db.prepare(`SELECT * FROM auth_sessions WHERE conversation_id = @cid`).get({ "@cid": conversationId }) as AuthSessionRow | undefined;
  if (!row) throw new Error(`No auth_session for conversation ${conversationId}`);
  return row;
}

function setStage(conversationId: string, stage: AuthStage) {
  db.prepare(`UPDATE auth_sessions SET stage = @stage WHERE conversation_id = @cid`).run({ "@stage": stage, "@cid": conversationId });
}

function setSubflow(conversationId: string, subflow: Subflow | null) {
  db.prepare(`UPDATE auth_sessions SET subflow = @sf WHERE conversation_id = @cid`).run({
    "@sf": subflow ? JSON.stringify(subflow) : null,
    "@cid": conversationId,
  });
}

function setUnknownStreak(conversationId: string, n: number) {
  db.prepare(`UPDATE auth_sessions SET unknown_streak = @n WHERE conversation_id = @cid`).run({ "@n": n, "@cid": conversationId });
}

function markAuthenticated(conversationId: string, customerId: string, authMethod: "PIN" | "EMAIL_OTP" | "SMS_OTP") {
  const now = new Date().toISOString();
  db.prepare(`UPDATE auth_sessions SET stage = 'AUTHENTICATED', authenticated_at = @now WHERE conversation_id = @cid`).run({ "@now": now, "@cid": conversationId });
  db.prepare(`UPDATE conversations SET auth_status = 'SUCCESS', auth_method = @method, customer_id = @custId WHERE id = @cid`).run({
    "@method": authMethod,
    "@custId": customerId,
    "@cid": conversationId,
  });
}

function markFailed(conversationId: string) {
  db.prepare(`UPDATE auth_sessions SET stage = 'FAILED', subflow = NULL WHERE conversation_id = @cid`).run({ "@cid": conversationId });
  db.prepare(`UPDATE conversations SET auth_status = 'FAILED' WHERE id = @cid`).run({ "@cid": conversationId });
}

// The call's primary intent is the first meaningful one, so later "yes"/"anything else" turns don't
// overwrite what the caller actually called about.
function noteIntent(conversationId: string, intent: Intent) {
  if (intent === "UNKNOWN") return;
  db.prepare(
    `UPDATE conversations SET detected_intent = @intent
     WHERE id = @cid AND (detected_intent IS NULL OR detected_intent = 'UNKNOWN' OR (detected_intent = 'AGENT_REQUEST' AND @intent <> 'AGENT_REQUEST'))`
  ).run({ "@intent": intent, "@cid": conversationId });
}

function storedIntent(conversationId: string): Intent | null {
  const row = db.prepare(`SELECT detected_intent FROM conversations WHERE id = @cid`).get({ "@cid": conversationId }) as { detected_intent: Intent | null } | undefined;
  return row?.detected_intent ?? null;
}

function firstRequestText(conversationId: string): string {
  const row = db
    .prepare(`SELECT text FROM transcript_turns WHERE conversation_id = @cid AND speaker = 'CUSTOMER' ORDER BY turn_index LIMIT 1`)
    .get({ "@cid": conversationId }) as { text: string } | undefined;
  return row?.text ?? "";
}

function callerAni(conversationId: string): string {
  const row = db.prepare(`SELECT ani FROM conversations WHERE id = @cid`).get({ "@cid": conversationId }) as { ani: string } | undefined;
  return row?.ani ?? "";
}

function lastAiAskedAnythingElse(conversationId: string): boolean {
  const row = db
    .prepare(`SELECT text FROM transcript_turns WHERE conversation_id = @cid AND speaker = 'AI' ORDER BY turn_index DESC LIMIT 1`)
    .get({ "@cid": conversationId }) as { text: string } | undefined;
  return Boolean(row?.text.trim().endsWith(ANYTHING_ELSE));
}

function hasEscalation(conversationId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM escalations WHERE conversation_id = @cid`).get({ "@cid": conversationId }));
}

function authStatusOf(session: AuthSessionRow): TurnResult["authStatus"] {
  return session.stage === "AUTHENTICATED" ? "SUCCESS" : session.stage === "FAILED" ? "FAILED" : "PENDING";
}

function reply(ctx: Ctx, aiText: string, extra: Partial<TurnResult> = {}): TurnResult {
  const session = loadSession(ctx.conversationId);
  return { aiText, stage: session.stage, authStatus: authStatusOf(session), ...extra };
}

function requireCustomer(session: AuthSessionRow): CustomerRow {
  if (!session.customer_id) throw new Error(`auth_session for ${session.conversation_id} has no customer_id at stage ${session.stage}`);
  const customer = findCustomerById(session.customer_id);
  if (!customer) throw new Error(`customer ${session.customer_id} not found`);
  return customer;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function style(s: TenantSettings): VoiceStyle {
  // Phrasing stays in English; a non-English tenant language is applied once, to the final reply.
  return { brandName: s.brandName, assistantName: s.assistantName, tone: s.voiceTone, languageName: "English" };
}

function phoneEnding(ani: string): string {
  const digits = ani.replace(/\D/g, "");
  return digits.length >= 4 ? `the number ending in ${digits.slice(-4).split("").join(" ")}` : "the number you're calling from";
}

// Read back digit-by-digit ("3 0 1 4") rather than as a number ("three thousand fourteen").
function spokenDigits(s: string): string {
  return s.replace(/\D/g, "").split("").join(" ");
}

// ---------- entry point ----------

const BARE_NO_RE = /^\s*(no|nope|nah|neither|none of them|no thanks)\b[.!]?\s*$/i;
const AGENT_RE = /\b(agent|representative|human|real person|live person|operator|customer service rep)\b|speak (to|with) (a |an )?(person|someone)/i;
const FAREWELL_RE = /\b(bye|goodbye|that'?s all|that is all|nothing else|no thanks|no thank you|i'?m (all )?(good|set|done)|that'?s it|all set)\b/i;

export async function advanceAuthSession(conversationId: string, utterance: string): Promise<TurnResult> {
  const settings = getSettings();
  const ctx: Ctx = { conversationId, session: loadSession(conversationId), settings, utterance };
  const result = await advance(ctx);
  if (settings.language !== "en-US") {
    const translated = await translateAI(result.aiText, LANGUAGE_NAMES[settings.language]);
    if (translated) result.aiText = translated;
  }
  return result;
}

async function advance(ctx: Ctx): Promise<TurnResult> {
  const { session, settings, utterance } = ctx;
  const subflow = session.subflow ? (JSON.parse(session.subflow) as Subflow) : null;

  if (session.stage === "FAILED") return escalationReply(ctx, "VERIFICATION_FAILED");

  // Escalation rule: asking for a person always works, at any point — including mid-CSAT-survey, since
  // a caller who changes their mind after declining ("actually, transfer me") is a real, natural case
  // (found live, Sep 29) and the old CSAT carve-out here silently swallowed it: the CSAT handler below
  // unconditionally ends the call on any unrecognized reply, rating or not, so the request just vanished.
  if (AGENT_RE.test(utterance)) {
    noteIntent(ctx.conversationId, "AGENT_REQUEST");
    return agentRequested(ctx);
  }

  if (subflow) return handleSubflow(ctx, subflow);

  if (FAREWELL_RE.test(utterance) && session.stage !== "AWAITING_INTENT") return closeCall(ctx);

  switch (session.stage) {
    case "AWAITING_INTENT": {
      // Best-effort intent capture before we know who's calling — verification still gates any data.
      const intent = await classify(ctx);
      noteIntent(ctx.conversationId, intent);
      if (intent === "AGENT_REQUEST") return agentRequested(ctx);
      if (intent === "SCHEDULE_CALLBACK") return startCallback(ctx, utterance); // needs no account access

      if (intent === "UNKNOWN") {
        const streak = session.unknown_streak + 1;
        setUnknownStreak(ctx.conversationId, streak);
        if (streak <= INTENT_RETRY_LIMIT) return reply(ctx, "Sorry, I didn't quite catch that. What can I help you with today?");
        // Gave it a retry and still can't tell — move on and identify the caller anyway.
      } else {
        setUnknownStreak(ctx.conversationId, 0);
      }

      setStage(ctx.conversationId, "AWAITING_BAN");
      setSubflow(ctx.conversationId, { type: "CUSTOMER_KIND" });
      const ack = intent !== "UNKNOWN" && isIntentEnabled(intent, settings) ? "I can help with that. " : "";
      return reply(ctx, `${ack}First, are you an existing Springfield Fiber customer, or a new customer?`);
    }

    case "AWAITING_BAN": {
      const extracted = await extractBan(utterance);
      if (!extracted) return reply(ctx, "I didn't catch an account number. Could you say it again? It's six digits, and you can also key it in.");
      if (!extracted.confident) {
        setSubflow(ctx.conversationId, { type: "CONFIRM_BAN", ban: extracted.value });
        return reply(ctx, `Just to confirm, your account number is ${spokenDigits(extracted.value)}. Is that right?`);
      }
      return lookupBan(ctx, extracted.value);
    }

    case "AWAITING_PIN": {
      const customer = requireCustomer(session);
      const extracted = await extractPin(utterance);
      if (!extracted) return reply(ctx, "Sorry, I didn't catch a PIN. Could you say your 4-digit PIN again?");
      if (!extracted.confident) {
        setSubflow(ctx.conversationId, { type: "CONFIRM_PIN", pin: extracted.value });
        return reply(ctx, `Just to confirm, your PIN is ${spokenDigits(extracted.value)}. Is that right?`);
      }
      return verifyPinTurn(ctx, customer, extracted.value);
    }

    case "AWAITING_OTP": {
      const customer = requireCustomer(session);
      const method = customer.mfa_method === "SMS" ? "SMS" : "EMAIL";

      if (/\bresend\b|\bsend (it )?again\b|\bnew code\b|didn'?t (get|receive)/i.test(utterance)) {
        issueOtp(ctx.conversationId, customer, method);
        return reply(ctx, "I've sent a new code. Please read it back to me when it arrives.");
      }

      const code = await extractOtp(utterance);
      if (!code) return reply(ctx, "I didn't catch that code. Could you read the six digits back to me?");

      const result = verifyOtp(ctx.conversationId, code);
      if (result.ok) {
        markAuthenticated(ctx.conversationId, customer.id, method === "SMS" ? "SMS_OTP" : "EMAIL_OTP");
        return afterVerified(ctx);
      }
      if (result.reason === "EXPIRED") return reply(ctx, "That code has expired. Say 'resend' and I'll send you a fresh one.");
      if (result.reason === "MAX_ATTEMPTS" || result.reason === "NO_PENDING_OTP") {
        markFailed(ctx.conversationId);
        return escalationReply(ctx, "OTP_FAILED");
      }
      return reply(ctx, "That code doesn't match. Please try again, or say 'resend' for a new one.");
    }

    case "AUTHENTICATED": {
      // "Wrong account, let me give you a different one" — re-verify against a new BAN/PIN without
      // ending the call. Checked before intent classification so it can't be misread as some other ask.
      if (SWITCH_ACCOUNT_RE.test(utterance)) return switchAccount(ctx);
      const intent = await classify(ctx);
      // "No, that's it" in answer to "Is there anything else?" means the caller is done.
      if (intent === "UNKNOWN" && lastAiAskedAnythingElse(ctx.conversationId) && (await parseYesNo(utterance, ANYTHING_ELSE)) === "NO") {
        return closeCall(ctx);
      }
      return handleIntent(ctx, intent, utterance);
    }
  }
}

// ---------- BAN / PIN verification (shared by the direct path and the confirm-if-unclear subflow) ----------

function lookupBan(ctx: Ctx, ban: string): TurnResult {
  db.prepare(`UPDATE conversations SET ban_provided = @ban WHERE id = @cid`).run({ "@ban": ban, "@cid": ctx.conversationId });
  const customer = findCustomerByBan(ban);
  if (!customer) {
    const session = loadSession(ctx.conversationId);
    const attempts = session.ban_attempts + 1;
    db.prepare(`UPDATE auth_sessions SET ban_attempts = @a WHERE conversation_id = @cid`).run({ "@a": attempts, "@cid": ctx.conversationId });
    if (attempts >= BAN_MAX_ATTEMPTS) {
      markFailed(ctx.conversationId);
      return escalationReply(ctx, "BAN_LOOKUP_FAILED");
    }
    return reply(
      ctx,
      `I couldn't find an account with that number. You have ${BAN_MAX_ATTEMPTS - attempts} attempt${BAN_MAX_ATTEMPTS - attempts === 1 ? "" : "s"} left — could you double-check it and try again?`
    );
  }
  db.prepare(`UPDATE auth_sessions SET customer_id = @custId WHERE conversation_id = @cid`).run({ "@custId": customer.id, "@cid": ctx.conversationId });
  return startCredentialStage(ctx, customer);
}

async function verifyPinTurn(ctx: Ctx, customer: CustomerRow, pin: string): Promise<TurnResult> {
  if (verifyPin(customer, pin)) {
    markAuthenticated(ctx.conversationId, customer.id, "PIN");
    return afterVerified(ctx);
  }
  const session = loadSession(ctx.conversationId);
  const attempts = session.pin_attempts + 1;
  db.prepare(`UPDATE auth_sessions SET pin_attempts = @a WHERE conversation_id = @cid`).run({ "@a": attempts, "@cid": ctx.conversationId });
  if (attempts >= PIN_MAX_ATTEMPTS) {
    markFailed(ctx.conversationId);
    return escalationReply(ctx, "PIN_LOCKOUT");
  }
  return reply(ctx, `That PIN doesn't match what we have on file. You have ${PIN_MAX_ATTEMPTS - attempts} attempt${PIN_MAX_ATTEMPTS - attempts === 1 ? "" : "s"} left. Please try again.`);
}

// Mid-call re-verification against a different account, without ending the call or repeating intent
// capture. A fresh BAN/PIN pair authenticates like any other, replacing the previous customer_id.
function switchAccount(ctx: Ctx): TurnResult {
  db.prepare(
    `UPDATE auth_sessions SET stage = 'AWAITING_BAN', customer_id = NULL, pin_attempts = 0, ban_attempts = 0, authenticated_at = NULL, subflow = NULL, unknown_streak = 0
     WHERE conversation_id = @cid`
  ).run({ "@cid": ctx.conversationId });
  db.prepare(`UPDATE conversations SET customer_id = NULL, auth_status = 'PENDING', auth_method = NULL, ban_provided = NULL WHERE id = @cid`).run({ "@cid": ctx.conversationId });
  return reply(ctx, "No problem — what's the other account number?");
}

async function classify(ctx: Ctx): Promise<Intent> {
  const examples = Object.fromEntries(Object.entries(ctx.settings.intentOverrides).map(([k, v]) => [k, v.examples])) as Partial<Record<Intent, string[]>>;
  return classifyIntent(ctx.utterance, examples);
}

// PIN only, for every caller, regardless of the account's seeded mfa_enabled/mfa_method (user
// decision, Sep 29 — "we are not doing MFA... remove that completely"). Supersedes the earlier
// "dynamic in-call MFA with phone-enrollment upsell" design; the AWAITING_OTP stage, otpService.ts,
// and the OTP-audit UI are left in place but now permanently unreachable rather than ripped out —
// AWAITING_OTP is part of the DB CHECK constraint on auth_sessions.stage, and removing it would need
// a full table rebuild for zero behavioral benefit, since nothing here ever sets that stage again.
function startCredentialStage(ctx: Ctx, customer: CustomerRow): TurnResult {
  const first = customer.name.split(" ")[0];
  setStage(ctx.conversationId, "AWAITING_PIN");
  return reply(ctx, `Thanks, ${first}. To verify it's you, please tell me your 4-digit PIN.`);
}

// Goal-directed: once verified, go straight to what the caller asked for at the start of the call.
async function afterVerified(ctx: Ctx): Promise<TurnResult> {
  ctx.session = loadSession(ctx.conversationId);
  const intent = storedIntent(ctx.conversationId);
  if (intent && intent !== "UNKNOWN" && intent !== "AGENT_REQUEST" && isIntentEnabled(intent, ctx.settings)) {
    const result = await handleIntent(ctx, intent, firstRequestText(ctx.conversationId));
    return { ...result, aiText: `Thanks, you're verified. ${result.aiText}` };
  }
  return reply(ctx, "Thanks, you're verified. How can I help you today?");
}

// ---------- intents (verified caller) ----------

async function handleIntent(ctx: Ctx, intent: Intent, utterance: string): Promise<TurnResult> {
  if (intent === "UNKNOWN" || !isIntentEnabled(intent, ctx.settings)) return notUnderstood(ctx, intent !== "UNKNOWN");
  setUnknownStreak(ctx.conversationId, 0);
  noteIntent(ctx.conversationId, intent);
  const customer = requireCustomer(ctx.session);

  switch (intent) {
    case "CHECK_BALANCE":
    case "PAYMENT_HISTORY":
    case "BILLING_DUE_DATE":
    case "PLAN_INFO":
    case "AUTOPAY_STATUS": {
      // Server decides which fields are authorized (businessLogic.ts); the AI only phrases them. If
      // phrasing fails, the deterministic template still gives a correct answer.
      const { instruction, data, fallbackText } = getIntentResponseData(customer, intent);
      const phrased = await phraseResponseAI(instruction, data, style(ctx.settings));
      return reply(ctx, `${phrased ?? fallbackText} ${ANYTHING_ELSE}`);
    }

    case "MAKE_PAYMENT": {
      if (customer.current_balance <= 0) return reply(ctx, `Your balance is already $0.00, so there's nothing to pay right now. ${ANYTHING_ELSE}`);
      setSubflow(ctx.conversationId, { type: "CONFIRM_PAYMENT", amount: customer.current_balance });
      return reply(ctx, `Your balance is ${money(customer.current_balance)}. Would you like me to charge the full ${money(customer.current_balance)} to the card on file now?`);
    }

    case "PAYMENT_PROMISE": {
      if (customer.current_balance <= 0) return reply(ctx, `Your balance is $0.00, so there's nothing to arrange. ${ANYTHING_ELSE}`);
      const amount = customer.current_balance;
      const date = await extractDate(utterance);
      if (date && validPromiseDate(date)) return confirmPromise(ctx, amount, date);
      setSubflow(ctx.conversationId, { type: "PAYMENT_PROMISE", step: "DATE", amount });
      return reply(ctx, `I can set up a payment arrangement for your balance of ${money(amount)}. What date can you pay by? It can be up to ${PROMISE_MAX_DAYS} days from today.`);
    }

    case "PLAN_CHANGE": {
      const plan = utterance ? await extractPlan(utterance) : null;
      if (plan && plan.name !== customer.plan_name) return confirmPlan(ctx, customer, plan.name);
      setSubflow(ctx.conversationId, { type: "PLAN_CHANGE", step: "CHOOSE" });
      return reply(ctx, planOptionsText(customer));
    }

    case "OUTAGE_CHECK": {
      const outage = findActiveOutage(customer.service_zip);
      if (outage) return reply(ctx, `${outageText(outage)} ${ANYTHING_ELSE}`);
      setSubflow(ctx.conversationId, { type: "TECH_VISIT", step: "OFFER" });
      return reply(ctx, `Good news: there are no known outages in your area right now. If you're having trouble, try this: ${TRIAGE_STEPS} If that doesn't fix it, I can book a technician visit. Would you like me to?`);
    }

    case "TECH_TRIAGE": {
      // Known outage first — no point troubleshooting a line that's down.
      const outage = findActiveOutage(customer.service_zip);
      if (outage) return reply(ctx, `${outageText(outage)} ${ANYTHING_ELSE}`);
      const phrased = await phraseResponseAI(
        "Walk the caller through basic troubleshooting in one or two sentences: unplug the modem and router for 30 seconds, plug them back in, and check the cables are firmly connected.",
        null,
        style(ctx.settings)
      );
      setSubflow(ctx.conversationId, { type: "TECH_VISIT", step: "OFFER" });
      return reply(ctx, `${phrased ?? `Let's try a quick fix: ${TRIAGE_STEPS}`} If that doesn't help, I can book a technician visit. Would you like me to?`);
    }

    case "SCHEDULE_TECH": {
      const outage = findActiveOutage(customer.service_zip);
      if (outage) return reply(ctx, `${outageText(outage)} A technician visit won't be needed for that. ${ANYTHING_ELSE}`);
      return startTechDate(ctx, utterance);
    }

    case "SCHEDULE_CALLBACK":
      return startCallback(ctx, utterance);

    case "SERVICE_AVAILABILITY":
      setSubflow(ctx.conversationId, { type: "EXISTING_SERVICE_ZIP" });
      return reply(ctx, "Sure — what ZIP code would you like me to check?");

    case "AGENT_REQUEST":
      return agentRequested(ctx);
  }
  return notUnderstood(ctx, false);
}

const TRIAGE_STEPS =
  "unplug your modem and router for about 30 seconds, plug them back in, and make sure the cables are firmly connected.";

function outageText(o: { description: string; eta: string | null }): string {
  return `There's a known outage in your area: ${o.description}. Our crews are on it${o.eta ? ` and we expect service back ${o.eta}` : ""}. There's no need to troubleshoot; service will come back on its own.`;
}

function planOptionsText(customer: CustomerRow): string {
  const current = findPlan(customer.plan_name);
  const options = PLAN_CATALOG.filter((p) => p.name !== customer.plan_name).map((p) => `${p.name} for $${p.monthlyPrice} a month`);
  return `You're currently on ${customer.plan_name}${current ? ` at $${current.monthlyPrice} a month` : ""}. The other plans are: ${options.join(", ")}. Which one would you like?`;
}

function confirmPlan(ctx: Ctx, customer: CustomerRow, planName: string): TurnResult {
  const target = findPlan(planName)!;
  const current = findPlan(customer.plan_name);
  setSubflow(ctx.conversationId, { type: "PLAN_CHANGE", step: "CONFIRM", plan: target.name });
  return reply(
    ctx,
    `Just to confirm: switch you from ${customer.plan_name}${current ? `, at $${current.monthlyPrice} a month,` : ""} to ${target.name} at $${target.monthlyPrice} a month, starting with your next bill? Please say yes to confirm.`
  );
}

function validPromiseDate(iso: string): boolean {
  const diff = daysBetween(todayLocal(), fromIsoDate(iso));
  return diff >= 0 && diff <= PROMISE_MAX_DAYS;
}

function confirmPromise(ctx: Ctx, amount: number, date: string): TurnResult {
  setSubflow(ctx.conversationId, { type: "PAYMENT_PROMISE", step: "CONFIRM", amount, date });
  return reply(ctx, `So you'll pay ${money(amount)} by ${speakDate(date)}. Shall I note that payment arrangement on your account?`);
}

async function startTechDate(ctx: Ctx, utterance: string): Promise<TurnResult> {
  const date = utterance ? await extractDate(utterance) : null;
  if (date && validTechDate(date)) {
    const window = parseWindow(utterance);
    if (window === "MORNING" || window === "AFTERNOON") return confirmTech(ctx, date, window);
    setSubflow(ctx.conversationId, { type: "TECH_VISIT", step: "WINDOW", date });
    return reply(ctx, `${speakDate(date)} works. Would you prefer the morning, 8 AM to 12 PM, or the afternoon, 12 to 5 PM?`);
  }
  setSubflow(ctx.conversationId, { type: "TECH_VISIT", step: "DATE" });
  return reply(ctx, `I can book a technician any day in the next ${TECH_MAX_DAYS} days, starting tomorrow. What day works for you?`);
}

function validTechDate(iso: string): boolean {
  const diff = daysBetween(todayLocal(), fromIsoDate(iso));
  return diff >= 1 && diff <= TECH_MAX_DAYS;
}

function confirmTech(ctx: Ctx, date: string, window: TimeWindow): TurnResult {
  setSubflow(ctx.conversationId, { type: "TECH_VISIT", step: "CONFIRM", date, window });
  return reply(ctx, `I'll book a technician for ${speakDate(date)} in the ${WINDOW_LABELS[window]}. Shall I confirm that?`);
}

// If the request already says when ("call me back tomorrow morning"), go straight to confirming it.
function startCallback(ctx: Ctx, utterance = ""): TurnResult {
  noteIntent(ctx.conversationId, "SCHEDULE_CALLBACK");
  setSubflow(ctx.conversationId, { type: "CALLBACK", step: "TIME" });
  const early = utterance ? callbackFromTime(ctx, parseSpokenDate(utterance), parseWindow(utterance)) : null;
  return early ?? reply(ctx, "Sure. When would you like us to call you back? For example, tomorrow morning or Friday afternoon.");
}

// Shared by the first request and the TIME step. Returns null when the words carry no usable time.
function callbackFromTime(ctx: Ctx, date: string | null, window: TimeWindow | null): TurnResult | null {
  if (!date && window) {
    // "in the afternoon" with no day → today, if that window hasn't started yet; otherwise tomorrow.
    const hour = new Date().getHours();
    const startHour = window === "MORNING" ? 8 : window === "AFTERNOON" ? 12 : 17;
    const day = hour < startHour ? todayLocal() : addDays(todayLocal(), 1);
    return confirmCallback(ctx, toIsoDate(day), window);
  }
  if (!date) return null;
  if (!validCallbackDate(date)) return reply(ctx, `We can call you back any time in the next ${CALLBACK_MAX_DAYS} days. When works for you?`);
  if (window) return confirmCallback(ctx, date, window);
  setSubflow(ctx.conversationId, { type: "CALLBACK", step: "WINDOW", date });
  return reply(ctx, `${speakDate(date)}. Morning, afternoon, or evening?`);
}

function validCallbackDate(iso: string): boolean {
  const diff = daysBetween(todayLocal(), fromIsoDate(iso));
  return diff >= 0 && diff <= CALLBACK_MAX_DAYS;
}

function confirmCallback(ctx: Ctx, date: string, window: TimeWindow): TurnResult {
  setSubflow(ctx.conversationId, { type: "CALLBACK", step: "CONFIRM", date, window });
  return reply(ctx, `We'll call you on ${phoneEnding(callerAni(ctx.conversationId))} on ${speakDate(date)} in the ${WINDOW_LABELS[window]}. Is that right?`);
}

// Out-of-flow behavior (PRD §6): never guess. First miss → a plain, natural re-prompt (no recited
// menu — reciting a 7-item keypad list out loud on every miss reads as robotic and was flagged as
// frustrating; the menu digits still work if a caller presses one, via classifyIntent's menuIntent()
// check — this only removes proactively reading the list out). Repeated misses (tenant rule) → state
// the limitation and offer a live agent or a callback.
function notUnderstood(ctx: Ctx, outOfScope: boolean): TurnResult {
  const streak = ctx.session.unknown_streak + 1;
  setUnknownStreak(ctx.conversationId, streak);
  if (outOfScope || streak >= ctx.settings.unknownTurnsBeforeEscalation) {
    setSubflow(ctx.conversationId, { type: "ESCALATION_OFFER" });
    const limit = outOfScope
      ? "I'm sorry, I can only help with things related to your Springfield Fiber account or service."
      : "I'm sorry, I'm not able to help with that myself, and I don't want to guess.";
    return reply(ctx, `${limit} I can transfer you to a live agent now, or have someone call you back. Which would you prefer?`);
  }
  return reply(ctx, "Sorry, I didn't quite catch that. Could you tell me again what you need?");
}

// ---------- subflows ----------

async function handleSubflow(ctx: Ctx, sf: Subflow): Promise<TurnResult> {
  const u = ctx.utterance;
  const cancelled = (): TurnResult => {
    setSubflow(ctx.conversationId, null);
    return ctx.session.stage === "AUTHENTICATED"
      ? reply(ctx, `No problem, I haven't changed anything. ${ANYTHING_ELSE}`)
      : reply(ctx, "No problem. To pull up your account, can you tell me your account number?");
  };

  switch (sf.type) {
    case "CUSTOMER_KIND": {
      const kind = parseCustomerKind(u);
      if (!kind) return reply(ctx, "Sorry, just to confirm — are you an existing Springfield Fiber customer, or a new customer?");
      // Natural conversation: a caller often answers both questions in one breath ("existing
      // residential customer") — check for that before falling back to asking separately.
      const accountType = parseAccountType(u);
      if (kind === "EXISTING") {
        if (accountType) {
          setSubflow(ctx.conversationId, null);
          return reply(ctx, "Thanks. Now, can you tell me your account number? It's the BAN on your bill.");
        }
        setSubflow(ctx.conversationId, { type: "ACCOUNT_TYPE", forNew: false });
        return reply(ctx, "Got it. Is this a residential or a business account?");
      }
      if (accountType) {
        setSubflow(ctx.conversationId, { type: "NEW_CUSTOMER_ZIP", accountType });
        return reply(ctx, "Great — what's the ZIP code where you'd like service?");
      }
      setSubflow(ctx.conversationId, { type: "ACCOUNT_TYPE", forNew: true });
      return reply(ctx, "Welcome! Are you looking for residential or business service?");
    }

    case "ACCOUNT_TYPE": {
      const accountType = parseAccountType(u);
      if (!accountType) {
        return reply(ctx, sf.forNew ? "Sorry, are you looking for residential or business service?" : "Sorry, is this a residential or a business account?");
      }
      if (!sf.forNew) {
        setSubflow(ctx.conversationId, null);
        return reply(ctx, "Thanks. Now, can you tell me your account number? It's the BAN on your bill.");
      }
      setSubflow(ctx.conversationId, { type: "NEW_CUSTOMER_ZIP", accountType });
      return reply(ctx, "Great — what's the ZIP code where you'd like service?");
    }

    case "NEW_CUSTOMER_ZIP": {
      const zip = extractZip(u);
      if (!zip) return reply(ctx, "Sorry, I didn't catch a ZIP code. Could you say the 5 digits again?");
      const kindLabel = sf.accountType === "BUSINESS" ? "business" : "residential";
      if (!isServiceAvailable(zip, sf.accountType)) {
        setSubflow(ctx.conversationId, null);
        return reply(ctx, `I'm sorry, Springfield Fiber ${kindLabel} service isn't available in ${zip} yet. ${fillTemplate(ctx.settings.closePrompt, ctx.settings)}`, { endCall: true });
      }
      setSubflow(ctx.conversationId, { type: "NEW_CUSTOMER_OFFER", accountType: sf.accountType });
      return reply(ctx, `Good news — Springfield Fiber ${kindLabel} service is available in ${zip}. I can transfer you to get signed up. Would you like me to do that?`);
    }

    case "NEW_CUSTOMER_OFFER": {
      const answer = await parseYesNo(u, "Transfer you to sign up?");
      if (answer === "NO") {
        setSubflow(ctx.conversationId, null);
        return closeCall(ctx);
      }
      if (answer !== "YES") return reply(ctx, "Would you like me to transfer you to sign up? Please say yes or no.");
      return newCustomerTransfer(ctx, sf.accountType);
    }

    case "EXISTING_SERVICE_ZIP": {
      const zip = extractZip(u);
      if (!zip) return reply(ctx, "Sorry, I didn't catch a ZIP code. Could you say the 5 digits again?");
      const customer = requireCustomer(ctx.session);
      const available = isServiceAvailable(zip, customer.customer_type);
      setSubflow(ctx.conversationId, null);
      return reply(
        ctx,
        `${available ? `Good news — Springfield Fiber service is available in ${zip}.` : `I'm sorry, Springfield Fiber service isn't available in ${zip} yet.`} ${ANYTHING_ELSE}`
      );
    }

    case "CONFIRM_BAN": {
      const answer = await parseYesNo(u, `Your account number is ${spokenDigits(sf.ban)}?`);
      if (answer === "YES") return lookupBan(ctx, sf.ban);
      if (answer === "NO") {
        setSubflow(ctx.conversationId, null);
        return reply(ctx, "Sorry about that — could you say your account number again?");
      }
      return reply(ctx, `Sorry, is your account number ${spokenDigits(sf.ban)}? Please say yes or no.`);
    }

    case "CONFIRM_PIN": {
      const customer = requireCustomer(ctx.session);
      const answer = await parseYesNo(u, `Your PIN is ${spokenDigits(sf.pin)}?`);
      if (answer === "YES") return verifyPinTurn(ctx, customer, sf.pin);
      if (answer === "NO") {
        setSubflow(ctx.conversationId, null);
        return reply(ctx, "Sorry about that — could you say your PIN again?");
      }
      return reply(ctx, `Sorry, is your PIN ${spokenDigits(sf.pin)}? Please say yes or no.`);
    }

    case "CONFIRM_PAYMENT": {
      const question = `Charge ${money(sf.amount)} to the card on file now?`;
      const answer = await parseYesNo(u, question);
      if (answer === "NO") return cancelled();
      if (answer !== "YES") return reply(ctx, `Sorry, should I go ahead and charge ${money(sf.amount)} now? Please say yes or no.`);
      const customer = requireCustomer(ctx.session);
      // Re-read the balance at commit time; if it changed since we asked, don't charge a stale amount.
      if (Math.abs(customer.current_balance - sf.amount) > 0.001) {
        setSubflow(ctx.conversationId, null);
        return reply(ctx, `Your balance changed while we were talking, so I didn't charge anything. It's now ${money(customer.current_balance)}. ${ANYTHING_ELSE}`);
      }
      applyPayment(customer.id, sf.amount);
      recordAction(ctx.conversationId, customer.id, "PAYMENT", "COMPLETED", { amount: sf.amount, method: "card on file" });
      setSubflow(ctx.conversationId, null);
      return reply(ctx, `Done. Your payment of ${money(sf.amount)} went through, and your balance is now $0.00. ${ANYTHING_ELSE}`);
    }

    case "PLAN_CHANGE": {
      const customer = requireCustomer(ctx.session);
      if (sf.step === "CHOOSE") {
        // A plan name wins over any "no"/"don't" in the sentence ("the fastest one, but I don't need TV").
        const plan = await extractPlan(u);
        if (!plan) {
          if (isCancel(u) || BARE_NO_RE.test(u)) return cancelled();
          return reply(ctx, `Sorry, I didn't catch which plan. ${planOptionsText(customer)}`);
        }
        if (plan.name === customer.plan_name) return reply(ctx, `You're already on ${plan.name}. Which other plan would you like, or say cancel to keep it?`);
        return confirmPlan(ctx, customer, plan.name);
      }
      const answer = await parseYesNo(u, `Switch to ${sf.plan}?`);
      if (answer === "NO") return cancelled();
      if (answer !== "YES") {
        const other = await extractPlan(u);
        if (other && other.name !== sf.plan && other.name !== customer.plan_name) return confirmPlan(ctx, customer, other.name);
        return reply(ctx, `Should I switch you to ${sf.plan}? Please say yes or no.`);
      }
      const target = findPlan(sf.plan)!;
      applyPlanChange(customer.id, target.name);
      recordAction(ctx.conversationId, customer.id, "PLAN_CHANGE", "COMPLETED", { fromPlan: customer.plan_name, toPlan: target.name, monthlyPrice: target.monthlyPrice });
      setSubflow(ctx.conversationId, null);
      return reply(ctx, `You're all set. You're now on ${target.name} at $${target.monthlyPrice} a month, starting with your next bill. ${ANYTHING_ELSE}`);
    }

    case "PAYMENT_PROMISE": {
      if (sf.step === "DATE") {
        if (isCancel(u)) return cancelled();
        const date = await extractDate(u);
        if (!date) return reply(ctx, "Sorry, I didn't catch a date. What day can you pay by? For example, next Friday or the 30th.");
        if (!validPromiseDate(date)) {
          return reply(ctx, `I can only set an arrangement up to ${speakDate(toIsoDate(addDays(todayLocal(), PROMISE_MAX_DAYS)))}. What date by then works for you?`);
        }
        return confirmPromise(ctx, sf.amount, date);
      }
      const answer = await parseYesNo(u, `Note a promise to pay ${money(sf.amount)} by ${sf.date}?`);
      if (answer === "NO") return cancelled();
      if (answer !== "YES") return reply(ctx, `Should I note that you'll pay ${money(sf.amount)} by ${speakDate(sf.date)}? Please say yes or no.`);
      const customer = requireCustomer(ctx.session);
      recordAction(ctx.conversationId, customer.id, "PAYMENT_PROMISE", "SCHEDULED", { amount: sf.amount }, sf.date);
      setSubflow(ctx.conversationId, null);
      return reply(ctx, `Done. I've noted your arrangement to pay ${money(sf.amount)} by ${speakDate(sf.date)}. ${ANYTHING_ELSE}`);
    }

    case "TECH_VISIT": {
      if (sf.step === "OFFER") {
        const answer = await parseYesNo(u, "Book a technician visit?");
        if (answer === "YES") return startTechDate(ctx, u);
        if (answer === "NO") {
          setSubflow(ctx.conversationId, null);
          return reply(ctx, `Okay. If the problem keeps happening, just call us back. ${ANYTHING_ELSE}`);
        }
        // Not a yes/no — treat it as a new request instead of trapping the caller in the offer.
        setSubflow(ctx.conversationId, null);
        ctx.session = loadSession(ctx.conversationId);
        return handleIntent(ctx, await classify(ctx), u);
      }
      if (isCancel(u)) return cancelled();
      if (sf.step === "DATE") {
        const date = await extractDate(u);
        if (!date) return reply(ctx, "Sorry, I didn't catch a day. Which day in the next week works for a technician visit?");
        if (!validTechDate(date)) return reply(ctx, `I can book any day from tomorrow through ${speakDate(toIsoDate(addDays(todayLocal(), TECH_MAX_DAYS)))}. Which day works?`);
        const window = parseWindow(u);
        if (window === "MORNING" || window === "AFTERNOON") return confirmTech(ctx, date, window);
        setSubflow(ctx.conversationId, { type: "TECH_VISIT", step: "WINDOW", date });
        return reply(ctx, `${speakDate(date)} works. Would you prefer the morning, 8 AM to 12 PM, or the afternoon, 12 to 5 PM?`);
      }
      if (sf.step === "WINDOW") {
        const window = parseWindow(u);
        if (window !== "MORNING" && window !== "AFTERNOON") return reply(ctx, "Technicians visit in the morning, 8 AM to 12 PM, or the afternoon, 12 to 5 PM. Which would you like?");
        return confirmTech(ctx, sf.date, window);
      }
      const answer = await parseYesNo(u, `Book a technician for ${sf.date} ${sf.window}?`);
      if (answer === "NO") return cancelled();
      if (answer !== "YES") return reply(ctx, `Should I book the technician for ${speakDate(sf.date)} in the ${WINDOW_LABELS[sf.window]}? Please say yes or no.`);
      const customer = requireCustomer(ctx.session);
      recordAction(ctx.conversationId, customer.id, "TECH_VISIT", "SCHEDULED", { window: sf.window, windowLabel: WINDOW_LABELS[sf.window], serviceZip: customer.service_zip }, sf.date);
      setSubflow(ctx.conversationId, null);
      return reply(ctx, `Booked. A technician will visit on ${speakDate(sf.date)} in the ${WINDOW_LABELS[sf.window]}. ${ANYTHING_ELSE}`);
    }

    case "CALLBACK": {
      if (isCancel(u)) return cancelled();
      if (sf.step === "TIME") {
        return (
          callbackFromTime(ctx, await extractDate(u), parseWindow(u)) ??
          reply(ctx, "Sorry, I didn't catch a time. When should we call you back? For example, tomorrow morning.")
        );
      }
      if (sf.step === "WINDOW") {
        const window = parseWindow(u);
        if (!window) return reply(ctx, "Would you like the call in the morning, afternoon, or evening?");
        return confirmCallback(ctx, sf.date, window);
      }
      const answer = await parseYesNo(u, `Call back on ${sf.date} ${sf.window}?`);
      if (answer === "NO") {
        setSubflow(ctx.conversationId, { type: "CALLBACK", step: "TIME" });
        return reply(ctx, "Okay, when would be better?");
      }
      if (answer !== "YES") return reply(ctx, "Is that time right? Please say yes or no.");
      const ani = callerAni(ctx.conversationId);
      recordAction(
        ctx.conversationId,
        ctx.session.customer_id,
        "CALLBACK",
        "SCHEDULED",
        { phone: ani, window: sf.window, windowLabel: WINDOW_LABELS[sf.window], reason: storedIntent(ctx.conversationId), verified: ctx.session.stage === "AUTHENTICATED" },
        sf.date
      );
      setSubflow(ctx.conversationId, null);
      const confirmed = `You're all set. We'll call you on ${speakDate(sf.date)} in the ${WINDOW_LABELS[sf.window]}.`;
      if (ctx.session.stage === "AUTHENTICATED") return reply(ctx, `${confirmed} ${ANYTHING_ELSE}`);
      return reply(ctx, `${confirmed} ${fillTemplate(ctx.settings.closePrompt, ctx.settings)}`, { endCall: true });
    }

    case "ESCALATION_OFFER": {
      setSubflow(ctx.conversationId, null);
      if (/\b(agent|transfer|person|human|now|first|someone now)\b/i.test(u)) return escalationReply(ctx, "UNRESOLVED_REQUEST");
      if (/\b(call ?back|call me|later|second|callback)\b/i.test(u)) return startCallback(ctx);
      if ((await parseYesNo(u, "Transfer to an agent?")) === "YES") return escalationReply(ctx, "UNRESOLVED_REQUEST");
      return reply(ctx, "Okay. How else can I help you?");
    }

    case "CSAT": {
      const rating = extractRating(u);
      if (rating) db.prepare(`UPDATE conversations SET csat_score = @r WHERE id = @cid`).run({ "@r": rating, "@cid": ctx.conversationId });
      setSubflow(ctx.conversationId, null);
      return reply(ctx, `${rating ? "Thank you for the feedback. " : ""}${fillTemplate(ctx.settings.closePrompt, ctx.settings)}`, { endCall: true });
    }
  }
}

// ---------- closing & escalation ----------

function closeCall(ctx: Ctx): TurnResult {
  const alreadyRated = db.prepare(`SELECT csat_score FROM conversations WHERE id = @cid`).get({ "@cid": ctx.conversationId }) as { csat_score: number | null };
  if (ctx.session.stage === "AUTHENTICATED" && ctx.settings.csatSurveyEnabled && alreadyRated.csat_score === null && !hasEscalation(ctx.conversationId)) {
    setSubflow(ctx.conversationId, { type: "CSAT" });
    return reply(ctx, "Before you go: on a scale of 1 to 5, how satisfied are you with this call? Just say or press a number.");
  }
  return reply(ctx, fillTemplate(ctx.settings.closePrompt, ctx.settings), { endCall: true });
}

function agentRequested(ctx: Ctx): TurnResult {
  if (!ctx.settings.escalateOnAgentRequest) {
    return startCallbackWithNote(ctx, "I'm not able to transfer calls right now, but I can have someone call you back.");
  }
  return escalationReply(ctx, "CALLER_REQUESTED");
}

function startCallbackWithNote(ctx: Ctx, note: string): TurnResult {
  const r = startCallback(ctx);
  return { ...r, aiText: `${note} ${r.aiText}` };
}

// Every live-agent transfer announces a routing code before hanging up — there's no real agent queue
// in this deployment, but the call still ends looking like it was routed somewhere specific. The code
// is picked by the caller's actual (first, primary) topic, not one shared bucket for every transfer
// reason — so a call's transcript can show what queue it *should* have gone to next to what it
// actually announced, and ops can spot a misroute at a glance (user request).
// Natural, spoken description of what the caller was calling about — said back alongside the routing
// code on transfer (user request, Sep 30: "the customer should be sure they're being routed for the
// correct intent"). AGENT_REQUEST/UNKNOWN are deliberately omitted: "transferring you about talking to
// an agent" is circular, and there's nothing concrete to name when nothing was ever understood.
const INTENT_TRANSFER_TOPIC: Partial<Record<Intent, string>> = {
  CHECK_BALANCE: "checking your balance",
  MAKE_PAYMENT: "making a payment",
  PAYMENT_HISTORY: "a past payment",
  BILLING_DUE_DATE: "your billing due date",
  PAYMENT_PROMISE: "a payment arrangement",
  PLAN_INFO: "your plan",
  PLAN_CHANGE: "changing your plan",
  AUTOPAY_STATUS: "autopay",
  OUTAGE_CHECK: "a service outage",
  TECH_TRIAGE: "a technical issue",
  SCHEDULE_TECH: "booking a technician visit",
  SCHEDULE_CALLBACK: "a callback",
  SERVICE_AVAILABILITY: "service availability",
};

function escalationReply(ctx: Ctx, reason: EscalationReason): TurnResult {
  const intent = storedIntent(ctx.conversationId);
  const code = routingCodeForIntent(ctx.settings, intent);
  createEscalation(ctx.conversationId, reason, code);
  setSubflow(ctx.conversationId, null);
  const verified = loadSession(ctx.conversationId).stage === "AUTHENTICATED";
  const intro =
    reason === "PIN_LOCKOUT" || reason === "OTP_FAILED" || reason === "VERIFICATION_FAILED" || reason === "BAN_LOOKUP_FAILED"
      ? "I'm not able to verify your identity on this call, so I'm transferring you to a live agent who can help."
      : "I'm transferring you to a live agent now.";
  const context = verified
    ? "I've captured a summary of our conversation, so you won't have to repeat yourself."
    : "I've passed along what you've told me so far; the agent will verify your identity first.";
  const topic = intent ? INTENT_TRANSFER_TOPIC[intent] : undefined;
  const about = topic ? ` about ${topic}` : "";
  return reply(ctx, `${intro} ${context} Transferring you${about} to agent ${spokenDigits(code)}.`, { endCall: true, transfer: true });
}

// New (not-yet-a-customer) caller, after confirming they want to sign up — same "announce a code,
// then hang up" shape as escalationReply, but logged with no customer/BAN context to verify.
function newCustomerTransfer(ctx: Ctx, accountType: CustomerType): TurnResult {
  const code = accountType === "BUSINESS" ? ctx.settings.routingCodes.newCustomerBusiness : ctx.settings.routingCodes.newCustomerResidential;
  createEscalation(ctx.conversationId, "NEW_CUSTOMER_ENROLLMENT", code);
  setSubflow(ctx.conversationId, null);
  return reply(ctx, `Great, I'm transferring you to sign up now. Your reference code is ${spokenDigits(code)}.`, { endCall: true, transfer: true });
}

export { getDevOtp };
