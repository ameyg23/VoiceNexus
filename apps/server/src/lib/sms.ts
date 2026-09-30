// Twilio SMS delivery for SMS-method OTPs (ARCHITECTURE.md §17). The `twilio` package is already a
// dependency (routes/twilio.ts uses it for TwiML + webhook signature validation) but was never
// instantiated as a REST client — this is that client, used only to send. Never throws: a failed send
// is logged and the caller keeps going, since the dev OTP console/log is always available as a
// fallback (otpService.ts) — same contract as email.ts.
//
// Twilio trial accounts can only SMS numbers verified in the console (error 21608) — every seeded
// demo phone number will fail this in trial mode, exactly like the Resend-sandbox limitation already
// noted in CLAUDE.md for email OTP.

import twilio from "twilio";

let client: ReturnType<typeof twilio> | null | undefined;

function getClient(): ReturnType<typeof twilio> | null {
  if (client !== undefined) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  client = sid && token ? twilio(sid, token) : null;
  return client;
}

function toE164(phone: string): string {
  if (phone.startsWith("+")) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function sendOtpSms(to: string, code: string): Promise<boolean> {
  const c = getClient();
  const from = process.env.TWILIO_CARE_LINE_NUMBER;
  if (!c || !from) {
    console.warn("[sms] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_CARE_LINE_NUMBER not set — OTP only available via dev console");
    return false;
  }

  try {
    await c.messages.create({
      to: toE164(to),
      from,
      body: `Your Springfield Fiber verification code is ${code}. It expires in 5 minutes.`,
    });
    return true;
  } catch (err) {
    console.error("[sms] Twilio send failed (trial accounts can only SMS verified numbers):", err instanceof Error ? err.message : err);
    return false;
  }
}
