-- Existing-vs-new-customer flow (user walkthrough, Sep 24 later session): ask existing/new and
-- residential/business before the account number, a 3-attempt lockout on an unrecognized BAN
-- (mirroring the existing PIN lockout), a new-customer ZIP/service-availability check, and spoken
-- routing codes on every live-agent transfer. ALTERs first: on a re-run the first one hits
-- "duplicate column name", which migrate.ts treats as "whole file already applied".

ALTER TABLE auth_sessions ADD COLUMN ban_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'RESIDENTIAL';
ALTER TABLE escalations ADD COLUMN routing_code TEXT;

-- Demo variety: a couple of the seeded accounts are business accounts.
UPDATE customers SET customer_type = 'BUSINESS' WHERE id IN ('CUS005', 'CUS008');

-- Coverage by ZIP for the new-customer "is service available in my area" flow, checked separately
-- for residential vs business service. Includes every seeded customer's ZIP (so an existing-customer
-- ZIP always reads as covered) plus a couple of not-yet-covered ones for a realistic demo mix.
CREATE TABLE IF NOT EXISTS service_areas (
  zip TEXT PRIMARY KEY,
  residential_available INTEGER NOT NULL DEFAULT 1,
  business_available INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO service_areas (zip, residential_available, business_available) VALUES
  ('62701', 1, 1),
  ('62702', 1, 1),
  ('62703', 1, 0),
  ('62704', 1, 1),
  ('62705', 0, 1),
  ('62706', 0, 0);
