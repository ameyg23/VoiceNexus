-- Real telephony (ARCHITECTURE.md §19). Demo-mode calls stay channel 'DEMO'; calls arriving on the
-- Twilio care line are 'PHONE' and carry their CallSid so status/recording webhooks can find them.
-- On a re-run the first ALTER hits "duplicate column name", which migrate.ts treats as "whole file
-- already applied".

ALTER TABLE conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'DEMO';
ALTER TABLE conversations ADD COLUMN twilio_call_sid TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_call_sid ON conversations(twilio_call_sid);
