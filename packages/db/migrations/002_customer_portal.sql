-- Customer self-service portal (separate from phone-call BAN+PIN/OTP auth — this is a web
-- login, distinct from the 4-digit phone PIN). See CLAUDE.md "Key decisions" for the split.

ALTER TABLE customers ADD COLUMN portal_password_hash TEXT;
