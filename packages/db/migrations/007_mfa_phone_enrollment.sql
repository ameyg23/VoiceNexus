-- Dynamic in-call MFA (Sep 29 session): instead of a fixed per-customer OTP method, the call decides
-- live — no MFA on file -> PIN, email on file -> email OTP (with an offer to enroll a phone for faster
-- codes next time), phone on file -> real SMS OTP via Twilio. Enrolling a phone flips mfa_method to
-- 'SMS' (see authStateMachine.ts enrollMfaPhone), so "phone wins once both exist" falls out of the
-- existing NONE/EMAIL/SMS enum for free — no CHECK-constraint rebuild needed.
--
-- ALTER first: on a re-run it hits "duplicate column name", which migrate.ts treats as a no-op.

ALTER TABLE customers ADD COLUMN mfa_phone_number TEXT;

-- Backfill: the 3 seeded SMS-OTP customers already have a phone to send to.
UPDATE customers SET mfa_phone_number = phone_number WHERE mfa_method = 'SMS' AND mfa_phone_number IS NULL;
