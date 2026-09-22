import { Router } from "express";
import { getDevOtp } from "../lib/authStateMachine.js";

export const devRouter = Router();

// GET /api/dev/otp/:conversationId — dev-only plaintext OTP viewer.
// Only mounted when DEMO_MODE=true (see index.ts) — never a customer-facing API.
devRouter.get("/otp/:conversationId", (req, res) => {
  const code = getDevOtp(req.params.conversationId);
  if (!code) return res.status(404).json({ error: "no pending OTP for this conversation" });
  res.json({ conversationId: req.params.conversationId, code });
});
