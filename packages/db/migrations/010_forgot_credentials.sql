-- "I don't remember my account number/PIN" (user request, Sep 30): instead of looping on retries,
-- the assistant collects a ZIP code and hands off to a live agent who can look the caller up. The
-- ZIP is recorded the same way ban_provided already is, so the escalation summary states it plainly
-- instead of relying on the caller's raw last words. See authStateMachine.ts's FORGOT_CREDENTIALS_ZIP
-- subflow and escalations.ts.

ALTER TABLE conversations ADD COLUMN zip_provided TEXT;
