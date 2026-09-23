import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { openDb } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

function main() {
  const db = openDb();
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`Applying migration: ${file}`);
    try {
      db.exec(sql);
    } catch (err) {
      // Migrations are re-run on every `db:migrate` (no tracking table, matching this repo's
      // low-ceremony style) — CREATE TABLE/INDEX use IF NOT EXISTS so they're naturally
      // idempotent, but ALTER TABLE ADD COLUMN isn't. Treat "already there" as a no-op.
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicate column name/i.test(message)) {
        console.log(`  (already applied, skipping) ${message}`);
      } else {
        throw err;
      }
    }
  }

  console.log(`Done. ${files.length} migration(s) applied.`);
  db.close();
}

main();
