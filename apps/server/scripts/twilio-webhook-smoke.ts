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

// Follows <Redirect>s to /pending the way Twilio would while a slow turn finishes.
async function turn(action: string, input: Record<string, string>) {
  let res = await post(new URL(action).pathname + new URL(action).search, { ...common, ...input });
  let parsed = parse(res.body);
  while (parsed.redirect) {
    res = await post(new URL(parsed.redirect).pathname, common);
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
    ["intent (speech)", { SpeechResult: "I want to check my balance" }, (t) => /account number|BAN/i.test(t.says.join(" "))],
    ["silence re-prompts instead of guessing", { SpeechResult: "" }, (t) => /didn't hear/i.test(t.says.join(" ")) && !t.hangup],
    ["BAN (keypad DTMF)", { Digits: "100001" }, (t) => /PIN/i.test(t.says.join(" "))],
    ["PIN spoken digit-by-digit", { SpeechResult: "4 8 2 1" }, (t) => /verified/i.test(t.says.join(" "))],
    ["authenticated question", { SpeechResult: "what's my balance" }, (t) => t.says.length > 0 && !t.hangup],
    ["goodbye hangs up", { SpeechResult: "that's all, goodbye" }, (t) => t.hangup],
  ];

  let action = a.action!;
  for (const [label, input, ok] of steps) {
    const t = await turn(action, input);
    check(label, t.status === 200 && ok(t), t.body);
    console.log(`      caller: ${input.SpeechResult ?? input.Digits ?? ""}  →  AI: ${t.says.join(" ")}`);
    if (t.action) action = t.action;
  }

  const status = await post("/api/twilio/status", { ...common, CallStatus: "completed", CallDuration: "42" });
  check("status callback accepted", status.status === 204, `got ${status.status}`);

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
