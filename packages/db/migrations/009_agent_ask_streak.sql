-- Persistent "just transfer me" tracking (user request, Sep 30): at the very opening of a call, before
-- any real reason has been given, asking for an agent no longer transfers unverified on the first ask.
-- The assistant offers to help twice; only a 3rd insistence proceeds to full BAN+PIN verification and
-- transfers once verified, with the call's intent left unset ("not identified") since none was ever
-- stated. See authStateMachine.ts's top-level AGENT_RE branch and afterVerified().

ALTER TABLE auth_sessions ADD COLUMN agent_ask_streak INTEGER NOT NULL DEFAULT 0;
