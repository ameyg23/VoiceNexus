import { db } from "@voice-nexus/db";

export function nextConversationId(): string {
  const row = db.prepare(`SELECT COUNT(*) as count FROM conversations`).get() as { count: number };
  const n = row.count + 1;
  return `VN-${String(n).padStart(6, "0")}`;
}
