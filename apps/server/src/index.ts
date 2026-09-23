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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const app = express();
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
// Twilio webhooks are form-encoded and signature-checked inside the router (routes/twilio.ts).
app.use("/api/twilio", twilioRouter);

// Dev-only OTP console — mounted only when DEMO_MODE=true (ARCHITECTURE.md §10/§17).
if (process.env.DEMO_MODE === "true") {
  app.use("/api/dev", devRouter);
}

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
