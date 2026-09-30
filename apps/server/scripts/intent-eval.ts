// Intent recognition eval (PRD §9: "Intent classification F1 ≥ 0.90 on operator-curated eval set").
// Scores the classifier against a labeled set of caller utterances and reports per-intent precision /
// recall / F1 plus macro-F1.
//
//   npm run eval:intents --workspace=apps/server                 keyword/menu path only (no AI, free)
//   npm run eval:intents --workspace=apps/server -- --ai         Gemini path (≈1 request per utterance,
//                                                                throttled to stay under free-tier RPM)

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Intent } from "@voice-nexus/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const useAi = process.argv.includes("--ai");
if (useAi) dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
else process.env.GEMINI_API_KEY = ""; // forces the keyword fallback

const { classifyIntent } = await import("../src/lib/extraction.js");

// Operator-curated eval set: realistic phrasings, deliberately different from the classifier's own
// examples. Extend this list as real call transcripts come in.
const EVAL_SET: [string, Intent][] = [
  ["how much do I owe right now", "CHECK_BALANCE"],
  ["what's my current balance", "CHECK_BALANCE"],
  ["can you tell me my account balance please", "CHECK_BALANCE"],
  ["I'd like to pay my bill", "MAKE_PAYMENT"],
  ["I want to make a payment today", "MAKE_PAYMENT"],
  ["pay the full amount on my card", "MAKE_PAYMENT"],
  ["did my last payment go through", "PAYMENT_HISTORY"],
  ["when was the last time I paid", "PAYMENT_HISTORY"],
  ["what was my last payment amount", "PAYMENT_HISTORY"],
  ["when is my bill due", "BILLING_DUE_DATE"],
  ["what's the due date on my next bill", "BILLING_DUE_DATE"],
  ["when do I have to pay by", "BILLING_DUE_DATE"],
  ["I can't pay until next Friday", "PAYMENT_PROMISE"],
  ["can I get an extension on my bill", "PAYMENT_PROMISE"],
  ["I need a payment arrangement", "PAYMENT_PROMISE"],
  ["what plan am I on", "PLAN_INFO"],
  ["do I have any discount on my account", "PLAN_INFO"],
  ["what speed is my internet plan", "PLAN_INFO"],
  ["I want to upgrade to a faster plan", "PLAN_CHANGE"],
  ["switch me to the gig plan", "PLAN_CHANGE"],
  ["can I downgrade my package", "PLAN_CHANGE"],
  ["is autopay turned on", "AUTOPAY_STATUS"],
  ["am I set up for automatic payments", "AUTOPAY_STATUS"],
  ["do I have auto pay", "AUTOPAY_STATUS"],
  ["is there an outage in my area", "OUTAGE_CHECK"],
  ["is your network down right now", "OUTAGE_CHECK"],
  ["are you having an outage", "OUTAGE_CHECK"],
  ["my internet stopped working", "TECH_TRIAGE"],
  ["the wifi keeps dropping out", "TECH_TRIAGE"],
  ["my connection is super slow tonight", "TECH_TRIAGE"],
  ["I need a technician to come out", "SCHEDULE_TECH"],
  ["can you send someone to fix my line", "SCHEDULE_TECH"],
  ["book a tech appointment for me", "SCHEDULE_TECH"],
  ["can someone call me back later", "SCHEDULE_CALLBACK"],
  ["I'd rather get a call back tomorrow", "SCHEDULE_CALLBACK"],
  ["please ring me back this afternoon", "SCHEDULE_CALLBACK"],
  ["let me speak to a real person", "AGENT_REQUEST"],
  ["representative please", "AGENT_REQUEST"],
  ["I want to talk to a human", "AGENT_REQUEST"],
  ["do you serve my area?", "SERVICE_AVAILABILITY"],
  ["I'd like to sign up for service", "SERVICE_AVAILABILITY"],
  ["is my address in your service area?", "SERVICE_AVAILABILITY"],
  ["what's the weather like", "UNKNOWN"],
  ["um hello", "UNKNOWN"],
  ["I have a question about something", "UNKNOWN"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { text: string; expected: Intent; got: Intent }[] = [];
for (const [text, expected] of EVAL_SET) {
  const got = await classifyIntent(text);
  results.push({ text, expected, got });
  if (useAi) await sleep(4500);
}

const intents = [...new Set(EVAL_SET.map(([, i]) => i))];
let f1Sum = 0;
console.log(`Intent eval — ${useAi ? "Gemini" : "keyword fallback"} path, ${results.length} utterances\n`);
console.log("intent              precision  recall   F1");
for (const intent of intents) {
  const tp = results.filter((r) => r.got === intent && r.expected === intent).length;
  const fp = results.filter((r) => r.got === intent && r.expected !== intent).length;
  const fn = results.filter((r) => r.got !== intent && r.expected === intent).length;
  const p = tp + fp ? tp / (tp + fp) : 0;
  const rc = tp + fn ? tp / (tp + fn) : 0;
  const f1 = p + rc ? (2 * p * rc) / (p + rc) : 0;
  f1Sum += f1;
  console.log(`${intent.padEnd(20)}${p.toFixed(2).padStart(9)}${rc.toFixed(2).padStart(8)}${f1.toFixed(2).padStart(7)}`);
}
const macro = f1Sum / intents.length;
const accuracy = results.filter((r) => r.got === r.expected).length / results.length;
console.log(`\nAccuracy ${accuracy.toFixed(3)} · macro-F1 ${macro.toFixed(3)} · PRD target 0.90 → ${macro >= 0.9 ? "MET" : "NOT MET"}`);
const misses = results.filter((r) => r.got !== r.expected);
if (misses.length) {
  console.log("\nMisclassified:");
  for (const m of misses) console.log(`  "${m.text}" → ${m.got} (expected ${m.expected})`);
}
