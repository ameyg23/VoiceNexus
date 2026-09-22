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
    db.exec(sql);
  }

  console.log(`Done. ${files.length} migration(s) applied.`);
  db.close();
}

main();
