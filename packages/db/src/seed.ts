import bcrypt from "bcryptjs";
import { openDb } from "./index.js";

interface SeedCustomer {
  id: string;
  name: string;
  phoneNumber: string;
  ban: string;
  pin: string; // plaintext here only, hashed before insert
  email: string;
  mfaEnabled: boolean;
  mfaMethod: "NONE" | "EMAIL" | "SMS";
  currentBalance: number;
  lastPaymentAmount: number;
  lastPaymentDate: string;
  nextBillingDueDate: string;
  pastDueAmount: number;
  discountPercent: number;
  autopayEnabled: boolean;
  planName: string;
  accountStatus: string;
}

// 9 customers: 3 PIN-only, 3 Email OTP, 3 SMS OTP.
const customers: SeedCustomer[] = [
  {
    id: "CUS001", name: "Amara Okafor", phoneNumber: "+15550101001", ban: "BAN100001", pin: "4821",
    email: "amara.okafor@example.com", mfaEnabled: false, mfaMethod: "NONE",
    currentBalance: 84.32, lastPaymentAmount: 84.32, lastPaymentDate: "2026-08-15",
    nextBillingDueDate: "2026-09-28", pastDueAmount: 0, discountPercent: 0,
    autopayEnabled: true, planName: "Fiber 500", accountStatus: "ACTIVE",
  },
  {
    id: "CUS002", name: "Ben Torres", phoneNumber: "+15550101002", ban: "BAN100002", pin: "1197",
    email: "ben.torres@example.com", mfaEnabled: false, mfaMethod: "NONE",
    currentBalance: 142.10, lastPaymentAmount: 60.00, lastPaymentDate: "2026-08-02",
    nextBillingDueDate: "2026-09-20", pastDueAmount: 82.10, discountPercent: 10,
    autopayEnabled: false, planName: "Fiber 1000", accountStatus: "ACTIVE",
  },
  {
    id: "CUS003", name: "Chidi Nwosu", phoneNumber: "+15550101003", ban: "BAN100003", pin: "5560",
    email: "chidi.nwosu@example.com", mfaEnabled: false, mfaMethod: "NONE",
    currentBalance: 0, lastPaymentAmount: 55.99, lastPaymentDate: "2026-09-01",
    nextBillingDueDate: "2026-10-01", pastDueAmount: 0, discountPercent: 0,
    autopayEnabled: true, planName: "Cable Basic", accountStatus: "ACTIVE",
  },
  {
    id: "CUS004", name: "Dana Whitfield", phoneNumber: "+15550101004", ban: "BAN100004", pin: "3309",
    email: "amey.gaikwad@nforcone.com", mfaEnabled: true, mfaMethod: "EMAIL",
    currentBalance: 59.99, lastPaymentAmount: 59.99, lastPaymentDate: "2026-08-20",
    nextBillingDueDate: "2026-09-25", pastDueAmount: 0, discountPercent: 0,
    autopayEnabled: false, planName: "Fiber 300", accountStatus: "ACTIVE",
  },
  {
    id: "CUS005", name: "Ellis Park", phoneNumber: "+15550101005", ban: "BAN100005", pin: "7742",
    email: "amey.gaikwad@nforcone.com", mfaEnabled: true, mfaMethod: "EMAIL",
    currentBalance: 210.55, lastPaymentAmount: 0, lastPaymentDate: "2026-07-10",
    nextBillingDueDate: "2026-09-15", pastDueAmount: 210.55, discountPercent: 0,
    autopayEnabled: false, planName: "Fiber 500 + TV", accountStatus: "PAST_DUE",
  },
  {
    id: "CUS006", name: "Farrah Aziz", phoneNumber: "+15550101006", ban: "BAN100006", pin: "9013",
    email: "amey.gaikwad@nforcone.com", mfaEnabled: true, mfaMethod: "EMAIL",
    currentBalance: 45.00, lastPaymentAmount: 45.00, lastPaymentDate: "2026-09-05",
    nextBillingDueDate: "2026-10-05", pastDueAmount: 0, discountPercent: 15,
    autopayEnabled: true, planName: "Cable Basic", accountStatus: "ACTIVE",
  },
  {
    id: "CUS007", name: "Grace Lindqvist", phoneNumber: "+15550101007", ban: "BAN100007", pin: "2684",
    email: "grace.lindqvist@example.com", mfaEnabled: true, mfaMethod: "SMS",
    currentBalance: 99.99, lastPaymentAmount: 99.99, lastPaymentDate: "2026-08-28",
    nextBillingDueDate: "2026-09-28", pastDueAmount: 0, discountPercent: 0,
    autopayEnabled: true, planName: "Fiber 1000 + TV", accountStatus: "ACTIVE",
  },
  {
    id: "CUS008", name: "Hassan Malik", phoneNumber: "+15550101008", ban: "BAN100008", pin: "6157",
    email: "hassan.malik@example.com", mfaEnabled: true, mfaMethod: "SMS",
    currentBalance: 132.40, lastPaymentAmount: 70.00, lastPaymentDate: "2026-08-18",
    nextBillingDueDate: "2026-09-18", pastDueAmount: 62.40, discountPercent: 0,
    autopayEnabled: false, planName: "Fiber 300", accountStatus: "ACTIVE",
  },
  {
    id: "CUS009", name: "Ines Castellano", phoneNumber: "+15550101009", ban: "BAN100009", pin: "8420",
    email: "ines.castellano@example.com", mfaEnabled: true, mfaMethod: "SMS",
    currentBalance: 0, lastPaymentAmount: 84.99, lastPaymentDate: "2026-09-10",
    nextBillingDueDate: "2026-10-10", pastDueAmount: 0, discountPercent: 0,
    autopayEnabled: true, planName: "Fiber 500", accountStatus: "ACTIVE",
  },
];

const employees = [
  { name: "Priya Sharma", email: "priya.sharma@voicenexus.demo", password: "admin-demo-pass", role: "ADMIN" as const },
  { name: "Marcus Lee", email: "marcus.lee@voicenexus.demo", password: "agent-demo-pass", role: "AGENT" as const },
];

function main() {
  const db = openDb();
  const insertCustomer = db.prepare(`
    INSERT OR REPLACE INTO customers (
      id, name, phone_number, ban, pin_hash, email, mfa_enabled, mfa_method,
      current_balance, last_payment_amount, last_payment_date, next_billing_due_date,
      past_due_amount, discount_percent, autopay_enabled, plan_name, account_status
    ) VALUES (
      @id, @name, @phoneNumber, @ban, @pinHash, @email, @mfaEnabled, @mfaMethod,
      @currentBalance, @lastPaymentAmount, @lastPaymentDate, @nextBillingDueDate,
      @pastDueAmount, @discountPercent, @autopayEnabled, @planName, @accountStatus
    )
  `);

  db.exec("BEGIN");
  try {
    for (const c of customers) {
      insertCustomer.run({
        "@id": c.id,
        "@name": c.name,
        "@phoneNumber": c.phoneNumber,
        "@ban": c.ban,
        "@pinHash": bcrypt.hashSync(c.pin, 10),
        "@email": c.email,
        "@mfaEnabled": c.mfaEnabled ? 1 : 0,
        "@mfaMethod": c.mfaMethod,
        "@currentBalance": c.currentBalance,
        "@lastPaymentAmount": c.lastPaymentAmount,
        "@lastPaymentDate": c.lastPaymentDate,
        "@nextBillingDueDate": c.nextBillingDueDate,
        "@pastDueAmount": c.pastDueAmount,
        "@discountPercent": c.discountPercent,
        "@autopayEnabled": c.autopayEnabled ? 1 : 0,
        "@planName": c.planName,
        "@accountStatus": c.accountStatus,
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const insertEmployee = db.prepare(`
    INSERT OR REPLACE INTO employees (name, email, password_hash, role)
    VALUES (@name, @email, @passwordHash, @role)
  `);
  for (const e of employees) {
    insertEmployee.run({
      "@name": e.name,
      "@email": e.email,
      "@passwordHash": bcrypt.hashSync(e.password, 10),
      "@role": e.role,
    });
  }

  console.log(`Seeded ${customers.length} customers and ${employees.length} employees.`);
  console.log("PIN-only:", customers.filter((c) => c.mfaMethod === "NONE").map((c) => c.ban).join(", "));
  console.log("Email OTP:", customers.filter((c) => c.mfaMethod === "EMAIL").map((c) => c.ban).join(", "));
  console.log("SMS OTP:", customers.filter((c) => c.mfaMethod === "SMS").map((c) => c.ban).join(", "));
  db.close();
}

main();
