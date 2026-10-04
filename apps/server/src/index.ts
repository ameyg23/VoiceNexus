import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { db } from "@voice-nexus/db";
import { callsRouter } from "./routes/calls.js";
import { devRouter } from "./routes/dev.js";
import { authRouter } from "./routes/auth.js";
import { employeeAuthRouter } from "./routes/employeeAuth.js";
import { customerAuthRouter } from "./routes/customerAuth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { conversationsRouter } from "./routes/conversations.js";
import { customersRouter } from "./routes/customers.js";
import { twilioRouter } from "./routes/twilio.js";
import { settingsRouter, escalationsRouter, actionsRouter } from "./routes/operations.js";
import { getSettings } from "./lib/settings.js";
import { PLAN_CATALOG, isServiceAvailable } from "./lib/businessLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const app = express();
// Behind nginx in production (deploy/nginx.conf.example) req.ip would otherwise always read as
// nginx's own loopback address — trusting just the loopback hop lets Express read the real visitor IP
// from X-Forwarded-For, which the public (unauthenticated) Twilio token endpoint rate-limits by.
app.set("trust proxy", "loopback");
// credentials:true + an explicit origin (not "*") is required for the browser to send/accept the
// httpOnly session cookies set by employeeAuth.ts/customerAuth.ts across the :3000 -> :4000 origin gap.
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.use("/api/calls", callsRouter);
app.use("/api/auth", authRouter); // unified website login/logout/session
app.use("/api/auth/employee", employeeAuthRouter);
app.use("/api/auth/customer", customerAuthRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/escalations", escalationsRouter);
app.use("/api/actions", actionsRouter);
// Twilio webhooks are form-encoded and signature-checked inside the router (routes/twilio.ts).
app.use("/api/twilio", twilioRouter);

// Dev-only OTP console — mounted only when DEMO_MODE=true (ARCHITECTURE.md §10/§17).
if (process.env.DEMO_MODE === "true") {
  app.use("/api/dev", devRouter);
}

// GET /api/demo/config — the non-sensitive tenant settings the browser demo (and the public marketing
// site's "call customer care" section) needs: speech language, whether to record, brand name, and the
// care-line number to display.
app.get("/api/demo/config", (_req, res) => {
  const s = getSettings();
  res.json({
    brandName: s.brandName,
    assistantName: s.assistantName,
    language: s.language,
    recordingEnabled: s.recordingEnabled,
    careLineNumber: process.env.TWILIO_CARE_LINE_NUMBER ?? null,
  });
});

// GET /api/demo/plans — the same PLAN_CATALOG the phone AI and the authenticated get-started/account
// pages use, exposed publicly for the public marketing homepage (`/`, user request, Sep 30: "when we
// open the website we should see the commercial company page"), where a visitor isn't signed in yet
// and can't hit the customer-auth-gated /api/auth/customer/plans. No sensitive data — same catalog a
// call would recite anyway.
app.get("/api/demo/plans", (_req, res) => {
  res.json({ plans: PLAN_CATALOG });
});

// GET /api/demo/service-availability?zip=&accountType= — public equivalent of
// /api/auth/customer/service-availability, same service_areas lookup, for the public homepage's
// availability checker. A ZIP code + coverage flag isn't sensitive; no auth needed to ask it, same as
// asking over the phone before ever giving an account number.
app.get("/api/demo/service-availability", (req, res) => {
  const zip = String(req.query.zip ?? "").trim();
  const accountType = req.query.accountType === "BUSINESS" ? "BUSINESS" : "RESIDENTIAL";
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: "enter a 5-digit ZIP code" });
  res.json({ zip, accountType, available: isServiceAvailable(zip, accountType) });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, demoMode: process.env.DEMO_MODE === "true" });
});

// GET /api/demo/customers — name + masked phone only, for the "Select Customer" dropdown.
// Selecting a customer only sets the call's ANI; it does not grant auth (ARCHITECTURE.md §18).
app.get("/api/demo/customers", (_req, res) => {
  const rows = db
    .prepare(`SELECT id, name, phone_number as phoneNumber FROM customers ORDER BY name`)
    .all() as { id: string; name: string; phoneNumber: string }[];

  const customers = rows.map((c) => ({
    id: c.id,
    name: c.name,
    phoneNumber: c.phoneNumber, // fake demo data — frontend needs it to simulate ANI on /api/calls/start
    phoneNumberMasked: maskPhoneNumber(c.phoneNumber),
  }));

  res.json({ customers });
});

function maskPhoneNumber(phone: string): string {
  const match = phone.match(/^(\+\d{1,3})\d+(\d{4})$/);
  if (!match) return phone;
  const [, countryCode, last4] = match;
  return `${countryCode}***${last4}`;
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Voice Nexus server listening on http://localhost:${port}`);
});
