import { Router } from "express";
import { db } from "@voice-nexus/db";
import { requireEmployeeAuth } from "../lib/auth.js";

export const dashboardRouter = Router();

// GET /api/dashboard/summary — employee-only (ARCHITECTURE.md §10/§15). Minimal real numbers for
// now; the fuller dashboard (calls list, intents, escalations, reports) is separate, later scope.
dashboardRouter.get("/summary", requireEmployeeAuth, (_req, res) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) as totalConversations,
         SUM(CASE WHEN auth_status = 'SUCCESS' THEN 1 ELSE 0 END) as authSuccess,
         SUM(CASE WHEN auth_status = 'FAILED' THEN 1 ELSE 0 END) as authFailed,
         SUM(CASE WHEN auth_status = 'PENDING' THEN 1 ELSE 0 END) as authPending
       FROM conversations`
    )
    .get() as { totalConversations: number; authSuccess: number; authFailed: number; authPending: number };

  res.json(totals);
});
