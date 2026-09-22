-- Voice Nexus initial schema — mirrors ARCHITECTURE.md §4-9.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  ban TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_method TEXT NOT NULL DEFAULT 'NONE' CHECK (mfa_method IN ('NONE', 'EMAIL', 'SMS')),
  current_balance REAL NOT NULL DEFAULT 0,
  last_payment_amount REAL NOT NULL DEFAULT 0,
  last_payment_date TEXT,
  next_billing_due_date TEXT,
  past_due_amount REAL NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  autopay_enabled INTEGER NOT NULL DEFAULT 0,
  plan_name TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  ani TEXT NOT NULL,
  ban_provided TEXT,
  auth_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (auth_status IN ('PENDING', 'SUCCESS', 'FAILED')),
  auth_method TEXT CHECK (auth_method IN ('PIN', 'EMAIL_OTP', 'SMS_OTP')),
  detected_intent TEXT,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  start_time TEXT NOT NULL DEFAULT (datetime('now')),
  end_time TEXT,
  duration_seconds INTEGER,
  audio_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcript_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  turn_index INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('AI', 'CUSTOMER')),
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
  stage TEXT NOT NULL DEFAULT 'AWAITING_INTENT' CHECK (
    stage IN ('AWAITING_INTENT', 'AWAITING_BAN', 'AWAITING_PIN', 'AWAITING_OTP', 'AUTHENTICATED', 'FAILED')
  ),
  customer_id TEXT REFERENCES customers(id),
  pin_attempts INTEGER NOT NULL DEFAULT 0,
  authenticated_at TEXT
);

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  code_hash TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('EMAIL', 'SMS')),
  destination_masked TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'AGENT' CHECK (role IN ('ADMIN', 'AGENT', 'VIEWER'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_transcript_turns_conversation ON transcript_turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_otps_conversation ON otps(conversation_id);
