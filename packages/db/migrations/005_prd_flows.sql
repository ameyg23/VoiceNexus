-- PRD completion (VN-2/4/5/6/7/8/9): multi-step subflows, transactions, escalation handoffs,
-- callbacks, outages, per-tenant settings, CSAT, and turn latency telemetry.
-- ALTERs come first: on a re-run the first one hits "duplicate column name", which migrate.ts treats
-- as "whole file already applied" (every CREATE below is IF NOT EXISTS anyway).

ALTER TABLE customers ADD COLUMN service_zip TEXT;
-- Active multi-turn subflow for the call (JSON: { type, step, ... }), e.g. waiting on a yes/no before
-- charging a payment. Lives beside `stage`, which stays the source of truth for verification.
ALTER TABLE auth_sessions ADD COLUMN subflow TEXT;
-- Consecutive turns the caller's request couldn't be understood — drives the escalation rule.
ALTER TABLE auth_sessions ADD COLUMN unknown_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN csat_score INTEGER;
-- Server processing time for each AI reply (NFR: latency to first response).
ALTER TABLE transcript_turns ADD COLUMN latency_ms INTEGER;

-- Everything the assistant did on a call: completed transactions and scheduled follow-ups.
CREATE TABLE IF NOT EXISTS call_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  customer_id TEXT REFERENCES customers(id),
  type TEXT NOT NULL CHECK (type IN ('PAYMENT', 'PLAN_CHANGE', 'PAYMENT_PROMISE', 'TECH_VISIT', 'CALLBACK')),
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'SCHEDULED', 'DONE', 'CANCELLED')),
  details TEXT NOT NULL DEFAULT '{}',
  scheduled_for TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_actions_conversation ON call_actions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_call_actions_type_status ON call_actions(type, status);

-- Structured live-agent handoff (VN-5): who the caller is, whether they were verified, what they
-- wanted, and what was already attempted — so the agent never has to start from scratch.
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
  customer_id TEXT REFERENCES customers(id),
  verified INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  intent TEXT,
  summary TEXT NOT NULL,
  attempted TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'ACCEPTED', 'RESOLVED')),
  accepted_by INTEGER REFERENCES employees(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  resolved_at TEXT
);

-- Known service outages by service ZIP, checked before troubleshooting.
CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_zip TEXT NOT NULL,
  description TEXT NOT NULL,
  eta TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-tenant configuration (VN-7/VN-9), one JSON value per key. Defaults live in the server
-- (lib/settings.ts); a row here only exists once operations changes something.
CREATE TABLE IF NOT EXISTS tenant_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Demo data: Springfield service ZIPs for the seeded customers, and one active outage (62704).
UPDATE customers SET service_zip = '62701' WHERE id IN ('CUS001', 'CUS004', 'CUS007') AND service_zip IS NULL;
UPDATE customers SET service_zip = '62702' WHERE id IN ('CUS002', 'CUS005') AND service_zip IS NULL;
UPDATE customers SET service_zip = '62703' WHERE id IN ('CUS003', 'CUS006') AND service_zip IS NULL;
UPDATE customers SET service_zip = '62704' WHERE id IN ('CUS008', 'CUS009') AND service_zip IS NULL;
UPDATE customers SET service_zip = '62701' WHERE service_zip IS NULL;
INSERT INTO outages (service_zip, description, eta, active)
SELECT '62704', 'A fiber line cut near Clear Lake Ave is affecting internet and TV service', 'by 6 PM today', 1
WHERE NOT EXISTS (SELECT 1 FROM outages);
