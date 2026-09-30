import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { OtpMethod } from "@voice-nexus/shared";
import type { CustomerRow } from "./businessLogic.js";
import { maskEmail, maskPhone } from "./businessLogic.js";
import { sendOtpEmail } from "./email.js";
import { sendOtpSms } from "./sms.js";

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;

// Plaintext OTPs are NEVER persisted to the DB (otps.code_hash is hashed at rest —
// ARCHITECTURE.md §17). This in-memory map exists only to back the dev-only
// GET /api/dev/otp/:conversationId endpoint, gated behind DEMO_MODE=true.
const devOtpCache = new Map<string, string>();

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// `phoneOverride` is the number to text when it isn't the customer's already-enrolled
// `mfa_phone_number` yet — the phone-enrollment upsell (authStateMachine.ts) sends the verification
// code to the candidate number before it's persisted to the customer row. `emailOverride` is the same
// idea for email: a caller can ask for the code at any address, not just the one on file (user
// decision, Sep 29 — see CLAUDE.md) — never persisted to the customer row, just used for this send.
export function issueOtp(conversationId: string, customer: CustomerRow, method: OtpMethod, phoneOverride?: string, emailOverride?: string): void {
  const code = generateCode();
  const codeHash = bcrypt.hashSync(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();
  const phone = phoneOverride ?? customer.mfa_phone_number ?? customer.phone_number;
  const email = emailOverride ?? customer.email;
  const destinationMasked = method === "EMAIL" ? maskEmail(email) : maskPhone(phone);

  // Invalidate any prior pending OTP for this conversation before issuing a new one.
  db.prepare(`UPDATE otps SET status = 'EXPIRED' WHERE conversation_id = @cid AND status = 'PENDING'`).run({
    "@cid": conversationId,
  });

  db.prepare(`
    INSERT INTO otps (conversation_id, customer_id, code_hash, method, destination_masked, expires_at, attempts, status)
    VALUES (@cid, @custId, @codeHash, @method, @dest, @expiresAt, 0, 'PENDING')
  `).run({
    "@cid": conversationId,
    "@custId": customer.id,
    "@codeHash": codeHash,
    "@method": method,
    "@dest": destinationMasked,
    "@expiresAt": expiresAt,
  });

  devOtpCache.set(conversationId, code);

  if (method === "EMAIL") {
    // Fire-and-forget so the caller hears "I've sent a code" immediately; a failed send is logged
    // in email.ts and the dev console below still has the code.
    void sendOtpEmail(email, code).then((sent) => {
      if (sent) console.log(`[otp] emailed code to ${maskEmail(email)} for ${conversationId}`);
    });
  } else {
    void sendOtpSms(phone, code).then((sent) => {
      if (sent) console.log(`[otp] texted code to ${maskPhone(phone)} for ${conversationId}`);
    });
  }

  console.log(`[dev-otp] conversation=${conversationId} method=${method} code=${code} (expires ${expiresAt})`);
}

export function verifyOtp(
  conversationId: string,
  submittedCode: string
): { ok: boolean; reason?: "NO_PENDING_OTP" | "EXPIRED" | "MAX_ATTEMPTS" | "MISMATCH" } {
  const otp = db
    .prepare(`SELECT * FROM otps WHERE conversation_id = @cid AND status = 'PENDING' ORDER BY id DESC LIMIT 1`)
    .get({ "@cid": conversationId }) as
    | { id: number; code_hash: string; expires_at: string; attempts: number }
    | undefined;

  if (!otp) return { ok: false, reason: "NO_PENDING_OTP" };

  if (new Date(otp.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE otps SET status = 'EXPIRED' WHERE id = @id`).run({ "@id": otp.id });
    return { ok: false, reason: "EXPIRED" };
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare(`UPDATE otps SET status = 'FAILED' WHERE id = @id`).run({ "@id": otp.id });
    return { ok: false, reason: "MAX_ATTEMPTS" };
  }

  const match = bcrypt.compareSync(submittedCode, otp.code_hash);
  if (!match) {
    db.prepare(`UPDATE otps SET attempts = attempts + 1 WHERE id = @id`).run({ "@id": otp.id });
    const attemptsNow = otp.attempts + 1;
    if (attemptsNow >= OTP_MAX_ATTEMPTS) {
      db.prepare(`UPDATE otps SET status = 'FAILED' WHERE id = @id`).run({ "@id": otp.id });
    }
    return { ok: false, reason: "MISMATCH" };
  }

  db.prepare(`UPDATE otps SET status = 'VERIFIED' WHERE id = @id`).run({ "@id": otp.id });
  devOtpCache.delete(conversationId);
  return { ok: true };
}

export function getDevOtp(conversationId: string): string | undefined {
  return devOtpCache.get(conversationId);
}
