import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import cors from "cors";
import { db } from "@voice-nexus/db";
import { callsRouter } from "./routes/calls.js";
import { devRouter } from "./routes/dev.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/calls", callsRouter);

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
