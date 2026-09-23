import { db } from "@voice-nexus/db";

export function nextConversationId(): string {
  const row = db.prepare(`SELECT COUNT(*) as count FROM conversations`).get() as { count: number };
  const n = row.count + 1;
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
