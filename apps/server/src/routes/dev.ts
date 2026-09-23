import { Router } from "express";
import { getDevOtp } from "../lib/authStateMachine.js";

export const devRouter = Router();

// Tunnels (ngrok, for Twilio webhooks) make the whole server public, and conversation IDs are
// sequential — so refuse anything that arrived through a proxy. ngrok connects from localhost but
// always adds X-Forwarded-For; the local OTP console page never sends it.
devRouter.use((req, res, next) => {
  if (req.header("X-Forwarded-For")) return res.status(403).json({ error: "dev endpoints are local-only" });
  next();
});

// GET /api/dev/otp/:conversationId — dev-only plaintext OTP viewer.
// Only mounted when DEMO_MODE=true (see index.ts) — never a customer-facing API.
devRouter.get("/otp/:conversationId", (req, res) => {
  const code = getDevOtp(req.params.conversationId);
  if (!code) return res.status(404).json({ error: "no pending OTP for this conversation" });
  res.json({ conversationId: req.params.conversationId, code });
});
