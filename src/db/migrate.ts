import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

export async function migrate(): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )`;

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const rows = await sql`select filename from schema_migrations`;
  const applied = new Set(rows.map((r) => r.filename as string));

  for (const file of files) {
    if (applied.has(file)) continue;
    const query = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(query);
      await tx`insert into schema_migrations (filename) values (${file})`;
    });
    console.log(`[migrate] applied ${file}`);
  }
}
