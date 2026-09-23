-- One email per customer, so the website sign-in (email + password) always maps to exactly one account.
-- Case-insensitive to match routes/auth.ts, which lowercases before looking up.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique ON customers(lower(email));
