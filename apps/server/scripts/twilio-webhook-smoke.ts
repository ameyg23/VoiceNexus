// Simulates a full care-line phone call against the Twilio webhook adapter (routes/twilio.ts) by
// sending the same signed, form-encoded requests Twilio would — no real call, no Twilio credit.
// Validates request/response shape end to end: signature check, TwiML for each turn, DTMF input,
// silence handling, hang-up, and the status callback finalizing the conversation.
//
// Usage: npm run twilio:smoke --workspace=apps/server -- [baseUrl]
//   baseUrl defaults to PUBLIC_BASE_URL. The server must be running with that same PUBLIC_BASE_URL,
//   since Twilio signatures cover the full URL. Against ngrok this exercises the real public path.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import twilio from "twilio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const base = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!base || !authToken) {
  console.error("Need a base URL (arg or PUBLIC_BASE_URL) and TWILIO_AUTH_TOKEN");
  process.exit(1);
}

const callSid = `CAsmoke${Date.now()}`;
const common = { CallSid: callSid, AccountSid: process.env.TWILIO_ACCOUNT_SID ?? "", From: "+15550101001", To: process.env.TWILIO_CARE_LINE_NUMBER ?? "" };
let failures = 0;

async function post(pathAndQuery: string, params: Record<string, string>, sign = true) {
  const url = `${base}${pathAndQuery}`;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (sign) headers["X-Twilio-Signature"] = twilio.getExpectedTwilioSignature(authToken!, url, params);
  const res = await fetch(url, { method: "POST", headers, body: new URLSearchParams(params) });
  return { status: res.status, body: await res.text() };
}

function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      ${detail}`}`);
  if (!ok) failures++;
}

// Pull what the caller hears and where the next request goes out of the TwiML.
function parse(twiml: string) {
  const says = [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1]);
  const action = twiml.match(/<Gather[^>]*action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
  const redirect = twiml.match(/<Redirect[^>]*>([^<]+)<\/Redirect>/)?.[1];
  return { says, action, redirect, hangup: twiml.includes("<Hangup/>") };
}

// Follows <Redirect>s to /pending the way Twilio would while a slow turn finishes. `base` defaults to
// the main call's `common` — pass a different one (e.g. `silenceCommon`) for a call placed separately.
async function turn(action: string, input: Record<string, string>, base: Record<string, string> = common) {
  let res = await post(new URL(action).pathname + new URL(action).search, { ...base, ...input });
  let parsed = parse(res.body);
  while (parsed.redirect) {
    res = await post(new URL(parsed.redirect).pathname, base);
    parsed = parse(res.body);
  }
  return { ...res, ...parsed };
}

async function main() {
  console.log(`Smoke-testing Twilio webhooks at ${base} (CallSid ${callSid})\n`);

  const unsigned = await post("/api/twilio/voice", common, false);
  check("unsigned request rejected", unsigned.status === 403, `got ${unsigned.status}`);

  const answer = await post("/api/twilio/voice", common);
  const a = parse(answer.body);
  check("incoming call answered with greeting + <Gather>", answer.status === 200 && Boolean(a.action) && a.says.length > 0, answer.body);
  check("call recording started", answer.body.includes("<Recording"), answer.body);
  console.log(`      AI: ${a.says.join(" ")}`);

  const steps: [string, Record<string, string>, (t: Awaited<ReturnType<typeof turn>>) => boolean][] = [
    ["intent (speech)", { SpeechResult: "I want to check my balance" }, (t) => /existing.*customer|new customer/i.test(t.says.join(" "))],
    ["existing customer", { SpeechResult: "existing customer" }, (t) => /residential or (a )?business/i.test(t.says.join(" "))],
    ["residential", { SpeechResult: "residential" }, (t) => /account number|BAN/i.test(t.says.join(" "))],
    ["BAN (keypad DTMF)", { Digits: "100001" }, (t) => /PIN/i.test(t.says.join(" "))],
    ["PIN spoken digit-by-digit → verified, balance answered", { SpeechResult: "4 8 2 1" }, (t) => /verified.*\$\d/i.test(t.says.join(" "))],
    ["authenticated question", { SpeechResult: "when is my bill due" }, (t) => t.says.length > 0 && !t.hangup],
    ["goodbye → closing line, hangs up (CSAT off by default)", { SpeechResult: "that's all, goodbye" }, (t) => t.hangup],
  ];

  let action = a.action!;
  const turns = new Map<string, Awaited<ReturnType<typeof turn>>>();
  for (const [label, input, ok] of steps) {
    const t = await turn(action, input);
    check(label, t.status === 200 && ok(t), t.body);
    console.log(`      caller: ${input.SpeechResult ?? input.Digits ?? ""}  →  AI: ${t.says.join(" ")}`);
    turns.set(label, t);
    if (t.action) action = t.action;
  }

  const status = await post("/api/twilio/status", { ...common, CallStatus: "completed", CallDuration: "42" });
  check("status callback accepted", status.status === 204, `got ${status.status}`);

  // Digit entry (account number, PIN) gets a wider pause tolerance than normal conversation, so a
  // caller keying or reading digits slowly isn't rushed (user request, Sep 30: "3-4 secs gap between
  // each digit should be allowed").
  const banPrompt = turns.get("residential")!; // this turn's response is what asks for the account number
  check("account-number prompt widens pacing (timeout=8, speechTimeout=4)", /timeout="8"/.test(banPrompt.body) && /speechTimeout="4"/.test(banPrompt.body), banPrompt.body);
  const pinPrompt = turns.get("BAN (keypad DTMF)")!; // this turn's response is what asks for the PIN
  check("PIN prompt widens pacing (timeout=8, speechTimeout=4)", /timeout="8"/.test(pinPrompt.body) && /speechTimeout="4"/.test(pinPrompt.body), pinPrompt.body);
  const balancePrompt = turns.get("PIN spoken digit-by-digit → verified, balance answered")!; // no longer digit entry - normal pacing
  check("normal conversation stays at the regular pacing (timeout=6, speechTimeout=auto)", /timeout="6"/.test(balancePrompt.body) && /speechTimeout="auto"/.test(balancePrompt.body), balancePrompt.body);

  // First two silences each check in rather than hanging up (a caller pausing between questions
  // shouldn't get cut off — user request, Sep 29: "a customer might ask 56 questions... wait 5 secs";
  // widened to two check-ins, Sep 30: "ask are you still there... if not ask 1 more time... if not"
  // say goodbye). Only silence through BOTH check-ins in a row ends the call. Checked on its own fresh
  // call, since it can't be a step in the middle of the main flow above.
  console.log("\nSilence handling (separate call)");
  const silenceCallSid = `CAsmoke${Date.now()}sil`;
  const silenceCommon = { ...common, CallSid: silenceCallSid };
  const silenceAnswer = await post("/api/twilio/voice", silenceCommon);
  const silenceAction = parse(silenceAnswer.body).action!;
  const firstSilence = await turn(silenceAction, { SpeechResult: "" }, silenceCommon);
  check("first silence checks in instead of hanging up", !firstSilence.hangup && /still there/i.test(firstSilence.says.join(" ")), firstSilence.body);
  console.log(`      caller: (silence)  →  AI: ${firstSilence.says.join(" ")}`);
  const secondSilence = await turn(silenceAction, { SpeechResult: "" }, silenceCommon);
  check("second silence checks in again, doesn't hang up yet", !secondSilence.hangup && /still there/i.test(secondSilence.says.join(" ")), secondSilence.body);
  console.log(`      caller: (silence again)  →  AI: ${secondSilence.says.join(" ")}`);
  const thirdSilence = await turn(silenceAction, { SpeechResult: "" }, silenceCommon);
  check("third silence in a row ends the call with the closing line", thirdSilence.hangup && /call back once you're free.*nice day/i.test(thirdSilence.says.join(" ")), thirdSilence.body);
  console.log(`      caller: (silence a third time)  →  AI: ${thirdSilence.says.join(" ")}`);
  await post("/api/twilio/status", { ...silenceCommon, CallStatus: "completed", CallDuration: "12" });

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
