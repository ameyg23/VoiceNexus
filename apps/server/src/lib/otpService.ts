import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@voice-nexus/db";
import type { OtpMethod } from "@voice-nexus/shared";
import type { CustomerRow } from "./businessLogic.js";
import { maskEmail } from "./businessLogic.js";

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;

// Plaintext OTPs are NEVER persisted to the DB (otps.code_hash is hashed at rest —
// ARCHITECTURE.md §17). This in-memory map exists only to back the dev-only
// GET /api/dev/otp/:conversationId endpoint, gated behind DEMO_MODE=true.
const devOtpCache = new Map<string, string>();

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

export function issueOtp(conversationId: string, customer: CustomerRow, method: OtpMethod): void {
  const code = generateCode();
  const codeHash = bcrypt.hashSync(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();
  const destinationMasked = method === "EMAIL" ? maskEmail(customer.email) : "***-***-" + customer.id.slice(-4);

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

  if (method === "EMAIL" && process.env.RESEND_API_KEY) {
    // TODO(Sat): send via Resend once the account is set up. Deliberately deferred (CLAUDE.md).
    console.log(`[otp] RESEND_API_KEY set but Resend send not wired yet — falling back to dev console.`);
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
