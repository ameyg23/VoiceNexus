// One-shot Twilio configuration for real telephony (CLAUDE.md "Sat"/"Sun"). Idempotent — re-run it
// whenever the ngrok URL changes. Makes no calls and spends no credit; it only configures resources:
//
//   1. API key (for signing Voice SDK access tokens)          → TWILIO_API_KEY_SID / _SECRET in .env
//   2. TwiML App "Voice Nexus browser test call"              → TWILIO_TWIML_APP_SID in .env
//        voice URL  = {base}/api/twilio/client-voice, status callback = {base}/api/twilio/status
//   3. Care-line number's webhooks
//        voice URL  = {base}/api/twilio/voice,        status callback = {base}/api/twilio/status
//   4. PUBLIC_BASE_URL = {base} in .env (the URL Twilio signs requests against)
//
// Usage:  npm run twilio:setup --workspace=apps/server -- https://<id>.ngrok-free.app [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import twilio from "twilio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: ENV_PATH });

const TWIML_APP_NAME = "Voice Nexus browser test call";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const base = args.find((a) => a.startsWith("https://"))?.replace(/\/$/, "");
if (!base) {
  console.error("Usage: twilio-setup <https://public-base-url> [--dry-run]   (Twilio needs a public https URL, e.g. from ngrok)");
  process.exit(1);
}

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CARE_LINE_NUMBER } = process.env;
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CARE_LINE_NUMBER) {
  console.error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_CARE_LINE_NUMBER must be set in .env");
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const envUpdates: Record<string, string> = { PUBLIC_BASE_URL: base };

async function main() {
  console.log(`${dryRun ? "[dry run] " : ""}Configuring Twilio for ${base}\n`);

  // 1. API key — the secret is only returned at creation, so reuse an existing key from .env.
  if (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) {
    console.log(`API key: reusing ${process.env.TWILIO_API_KEY_SID}`);
  } else if (dryRun) {
    console.log("API key: would create one");
  } else {
    const key = await client.newKeys.create({ friendlyName: "Voice Nexus Voice SDK" });
    envUpdates.TWILIO_API_KEY_SID = key.sid;
    envUpdates.TWILIO_API_KEY_SECRET = key.secret;
    console.log(`API key: created ${key.sid}`);
  }

  // 2. TwiML App for browser calls.
  const appConfig = {
    friendlyName: TWIML_APP_NAME,
    voiceUrl: `${base}/api/twilio/client-voice`,
    voiceMethod: "POST",
    statusCallback: `${base}/api/twilio/status`,
    statusCallbackMethod: "POST",
  };
  const [existingApp] = await client.applications.list({ friendlyName: TWIML_APP_NAME, limit: 1 });
  if (dryRun) {
    console.log(`TwiML App: would ${existingApp ? `update ${existingApp.sid}` : "create"} → ${appConfig.voiceUrl}`);
  } else if (existingApp) {
    await client.applications(existingApp.sid).update(appConfig);
    envUpdates.TWILIO_TWIML_APP_SID = existingApp.sid;
    console.log(`TwiML App: updated ${existingApp.sid} → ${appConfig.voiceUrl}`);
  } else {
    const app = await client.applications.create(appConfig);
    envUpdates.TWILIO_TWIML_APP_SID = app.sid;
    console.log(`TwiML App: created ${app.sid} → ${appConfig.voiceUrl}`);
  }

  // 3. Care-line number webhooks.
  const [number] = await client.incomingPhoneNumbers.list({ phoneNumber: TWILIO_CARE_LINE_NUMBER, limit: 1 });
  if (!number) throw new Error(`${TWILIO_CARE_LINE_NUMBER} not found on this Twilio account`);
  const numberConfig = {
    voiceUrl: `${base}/api/twilio/voice`,
    voiceMethod: "POST",
    statusCallback: `${base}/api/twilio/status`,
    statusCallbackMethod: "POST",
  };
  if (dryRun) {
    console.log(`Care line ${TWILIO_CARE_LINE_NUMBER}: would set voice URL → ${numberConfig.voiceUrl} (currently ${number.voiceUrl || "unset"})`);
  } else {
    await client.incomingPhoneNumbers(number.sid).update(numberConfig);
    console.log(`Care line ${TWILIO_CARE_LINE_NUMBER}: voice URL → ${numberConfig.voiceUrl}`);
  }

  // 4. Persist to .env (gitignored). Secrets are written to the file, never printed.
  if (dryRun) {
    console.log(`\n.env: would set ${Object.keys(envUpdates).join(", ")}`);
    return;
  }
  upsertEnv(envUpdates);
  console.log(`\n.env: set ${Object.keys(envUpdates).join(", ")}. Restart the server to pick them up.`);
}

function upsertEnv(updates: Record<string, string>) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, line) : `${content.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

main().catch((err) => {
  console.error("Twilio setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
