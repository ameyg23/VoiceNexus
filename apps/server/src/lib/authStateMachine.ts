import { db } from "@voice-nexus/db";
import type { AuthStage } from "@voice-nexus/shared";
import { extractBan, extractPin, extractOtp } from "./extraction.js";
import { findCustomerByBan, findCustomerById, verifyPin, type CustomerRow } from "./businessLogic.js";
import { issueOtp, verifyOtp, getDevOtp } from "./otpService.js";

const PIN_MAX_ATTEMPTS = 3;

interface AuthSessionRow {
  conversation_id: string;
  stage: AuthStage;
  customer_id: string | null;
  pin_attempts: number;
  authenticated_at: string | null;
}

export interface TurnResult {
  aiText: string;
  stage: AuthStage;
  authStatus: "PENDING" | "SUCCESS" | "FAILED";
}

function loadSession(conversationId: string): AuthSessionRow {
  const row = db.prepare(`SELECT * FROM auth_sessions WHERE conversation_id = @cid`).get({
    "@cid": conversationId,
  }) as AuthSessionRow | undefined;
  if (!row) throw new Error(`No auth_session for conversation ${conversationId}`);
  return row;
}

function setStage(conversationId: string, stage: AuthStage) {
  db.prepare(`UPDATE auth_sessions SET stage = @stage WHERE conversation_id = @cid`).run({
    "@stage": stage,
    "@cid": conversationId,
  });
}

function markAuthenticated(conversationId: string, customerId: string, authMethod: "PIN" | "EMAIL_OTP" | "SMS_OTP") {
  const now = new Date().toISOString();
  db.prepare(`UPDATE auth_sessions SET stage = 'AUTHENTICATED', authenticated_at = @now WHERE conversation_id = @cid`).run({
    "@now": now,
    "@cid": conversationId,
  });
  db.prepare(`UPDATE conversations SET auth_status = 'SUCCESS', auth_method = @method, customer_id = @custId WHERE id = @cid`).run(
    { "@method": authMethod, "@custId": customerId, "@cid": conversationId }
  );
}

function markFailed(conversationId: string) {
  db.prepare(`UPDATE auth_sessions SET stage = 'FAILED' WHERE conversation_id = @cid`).run({ "@cid": conversationId });
  db.prepare(`UPDATE conversations SET auth_status = 'FAILED' WHERE id = @cid`).run({ "@cid": conversationId });
}

const ESCALATION_TEXT =
  "I'm not able to verify your identity on this call, so I'll connect you with a live agent who can help — they'll have everything you've told me so far.";

export function advanceAuthSession(conversationId: string, utterance: string): TurnResult {
  const session = loadSession(conversationId);

  switch (session.stage) {
    case "AWAITING_INTENT": {
      // Rule-based placeholder — real intent classification lands Thursday (Claude).
      setStage(conversationId, "AWAITING_BAN");
      return {
        aiText: "Thanks for calling. To pull up your account, can you tell me your account number (BAN)?",
        stage: "AWAITING_BAN",
        authStatus: "PENDING",
      };
    }

    case "AWAITING_BAN": {
      const ban = extractBan(utterance);
      if (!ban) {
        return {
          aiText: "I didn't catch an account number — could you repeat it?",
          stage: "AWAITING_BAN",
          authStatus: "PENDING",
        };
      }

      db.prepare(`UPDATE conversations SET ban_provided = @ban WHERE id = @cid`).run({ "@ban": ban, "@cid": conversationId });

      const customer = findCustomerByBan(ban);
      if (!customer) {
        return {
          aiText: "I couldn't find an account with that number. Could you double-check and try again?",
          stage: "AWAITING_BAN",
          authStatus: "PENDING",
        };
      }

      db.prepare(`UPDATE auth_sessions SET customer_id = @custId WHERE conversation_id = @cid`).run({
        "@custId": customer.id,
        "@cid": conversationId,
      });

      return startCredentialStage(conversationId, customer);
    }

    case "AWAITING_PIN": {
      const customer = requireCustomer(session);
      const pin = extractPin(utterance);
      if (!pin) {
        return { aiText: "Sorry, I didn't catch a PIN — could you say your 4-digit PIN again?", stage: "AWAITING_PIN", authStatus: "PENDING" };
      }

      if (verifyPin(customer, pin)) {
        markAuthenticated(conversationId, customer.id, "PIN");
        return { aiText: "Thanks, you're verified. How can I help you today?", stage: "AUTHENTICATED", authStatus: "SUCCESS" };
      }

      const attempts = session.pin_attempts + 1;
      db.prepare(`UPDATE auth_sessions SET pin_attempts = @a WHERE conversation_id = @cid`).run({
        "@a": attempts,
        "@cid": conversationId,
      });

      if (attempts >= PIN_MAX_ATTEMPTS) {
        markFailed(conversationId);
        return { aiText: ESCALATION_TEXT, stage: "FAILED", authStatus: "FAILED" };
      }

      return {
        aiText: `That PIN doesn't match what we have on file. You have ${PIN_MAX_ATTEMPTS - attempts} attempt(s) left — please try again.`,
        stage: "AWAITING_PIN",
        authStatus: "PENDING",
      };
    }

    case "AWAITING_OTP": {
      const customer = requireCustomer(session);
      const authMethod = customer.mfa_method === "SMS" ? "SMS_OTP" : "EMAIL_OTP";

      if (/\bresend\b/i.test(utterance)) {
        issueOtp(conversationId, customer, customer.mfa_method === "SMS" ? "SMS" : "EMAIL");
        return {
          aiText: "I've sent a new code — please read it back to me when it arrives.",
          stage: "AWAITING_OTP",
          authStatus: "PENDING",
        };
      }

      const code = extractOtp(utterance);
      if (!code) {
        return { aiText: "I didn't catch that code — could you read it back to me?", stage: "AWAITING_OTP", authStatus: "PENDING" };
      }

      const result = verifyOtp(conversationId, code);
      if (result.ok) {
        markAuthenticated(conversationId, customer.id, authMethod);
        return { aiText: "Thanks, you're verified. How can I help you today?", stage: "AUTHENTICATED", authStatus: "SUCCESS" };
      }

      if (result.reason === "MAX_ATTEMPTS" || result.reason === "EXPIRED") {
        if (result.reason === "EXPIRED") {
          return {
            aiText: "That code expired. Say 'resend' and I'll send you a fresh one.",
            stage: "AWAITING_OTP",
            authStatus: "PENDING",
          };
        }
        markFailed(conversationId);
        return { aiText: ESCALATION_TEXT, stage: "FAILED", authStatus: "FAILED" };
      }

      return { aiText: "That code doesn't match. Please try again, or say 'resend' for a new one.", stage: "AWAITING_OTP", authStatus: "PENDING" };
    }

    case "AUTHENTICATED": {
      return {
        aiText: "You're verified. (Intent-driven account actions come online Thursday — for now this confirms the auth flow works end to end.)",
        stage: "AUTHENTICATED",
        authStatus: "SUCCESS",
      };
    }

    case "FAILED": {
      return { aiText: ESCALATION_TEXT, stage: "FAILED", authStatus: "FAILED" };
    }
  }
}

function requireCustomer(session: AuthSessionRow): CustomerRow {
  if (!session.customer_id) throw new Error(`auth_session for ${session.conversation_id} has no customer_id at stage ${session.stage}`);
  const customer = findCustomerById(session.customer_id);
  if (!customer) throw new Error(`customer ${session.customer_id} not found`);
  return customer;
}

function startCredentialStage(conversationId: string, customer: CustomerRow): TurnResult {
  if (!customer.mfa_enabled) {
    setStage(conversationId, "AWAITING_PIN");
    return { aiText: `Thanks, ${customer.name.split(" ")[0]}. Please tell me your 4-digit PIN.`, stage: "AWAITING_PIN", authStatus: "PENDING" };
  }

  const method = customer.mfa_method === "SMS" ? "SMS" : "EMAIL";
  issueOtp(conversationId, customer, method);
  setStage(conversationId, "AWAITING_OTP");
  const destination = method === "EMAIL" ? "your email" : "your phone";
  return {
    aiText: `Thanks, ${customer.name.split(" ")[0]}. I've sent a one-time code to ${destination}. Please read it back to me.`,
    stage: "AWAITING_OTP",
    authStatus: "PENDING",
  };
}

export { getDevOtp };
