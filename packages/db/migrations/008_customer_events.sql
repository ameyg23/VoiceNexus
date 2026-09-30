-- Web-triggered self-service actions that have no phone call behind them (e.g. a plan switch made
-- directly on the portal) - call_actions.conversation_id is NOT NULL REFERENCES conversations(id),
-- which is right for anything the phone/demo channel produces, but wrong to force on a pure web
-- action. This is a separate, minimal table rather than relaxing that constraint, so the "every
-- call_action traces back to a real call" invariant stays true for everything that already relied on
-- it (found Sep 30: self-service plan switching shipped with no way to show up in "Recent activity").
CREATE TABLE IF NOT EXISTS customer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_events_customer ON customer_events(customer_id);
