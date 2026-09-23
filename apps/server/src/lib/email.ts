// Resend email delivery for EMAIL-method OTPs (ARCHITECTURE.md §17). Plain fetch against the
// Resend REST API, no SDK — same approach as aiEngine.ts. Never throws: a failed send is logged
// and the caller keeps going, since the dev OTP console is always available as a fallback.

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10000;

export async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[email] RESEND_API_KEY / RESEND_FROM_EMAIL not set — OTP only available via dev console");
    return false;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Springfield Fiber <${from}>`,
        to: [to],
        subject: "Your Springfield Fiber verification code",
        text: `Your verification code is ${code}. It expires in 5 minutes.\n\nIf you didn't call Springfield Fiber, you can ignore this email.`,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[email] Resend HTTP ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] Resend send failed:", err);
    return false;
  }
}
