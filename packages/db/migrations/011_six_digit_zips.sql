-- Switch ZIP/postal codes from the original US 5-digit format to 6 digits (user request, Oct 4 - the
-- caller expects a 6-digit postal code, and extractZip()/the ZIP prompts were changed to match). Existing
-- rows get a trailing 0 appended rather than being renumbered, so they stay recognizably the same area
-- and nothing in the historical data looks arbitrary. Idempotent via the length() guard - safe to re-run.
UPDATE service_areas SET zip = zip || '0' WHERE length(zip) = 5;
UPDATE customers SET service_zip = service_zip || '0' WHERE length(service_zip) = 5;
UPDATE outages SET service_zip = service_zip || '0' WHERE length(service_zip) = 5;
