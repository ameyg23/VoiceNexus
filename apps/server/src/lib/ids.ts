import { db } from "@voice-nexus/db";

// MAX-based (not COUNT-based, found and fixed Sep 30): COUNT(*) silently collides with an existing ID
// the moment any conversation is deleted from the middle of the sequence rather than the end — every
// test-cleanup script this whole project uses (scenario-test.ts's restore(), and plenty of ad hoc
// manual cleanup this session) deletes exactly that way, and this had been quietly building toward a
// real crash (`UNIQUE constraint failed: conversations.id`) the whole time.
export function nextConversationId(): string {
  const row = db.prepare(`SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) as maxId FROM conversations`).get() as {
    maxId: number | null;
  };
  const n = (row.maxId ?? 0) + 1;
  return `VN-${String(n).padStart(6, "0")}`;
}

// MAX-based (not COUNT-based) so a portal signup never collides with the 9 fixed seed IDs/BANs.
export function nextCustomerId(): string {
  const row = db.prepare(`SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) as maxId FROM customers`).get() as {
    maxId: number | null;
  };
  const n = (row.maxId ?? 0) + 1;
  return `CUS${String(n).padStart(3, "0")}`;
}

export function nextBan(): string {
  const row = db.prepare(`SELECT MAX(CAST(SUBSTR(ban, 4) AS INTEGER)) as maxBan FROM customers`).get() as {
    maxBan: number | null;
  };
  const n = (row.maxBan ?? 100000) + 1;
  return `BAN${n}`;
}
