import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { getTestEnvironment } from "../tests/support/environment.mjs";

const env = getTestEnvironment();
const db = new Client({ connectionString: env.databaseUrl });
const target = new URL(env.databaseUrl); target.pathname = "/modelshot_restore_test";
const admin = new Client({ connectionString: env.databaseUrl });
const run = args => { const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", ...args], { encoding: "utf8", timeout: 60000 }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout; };
const started = Date.now();
try {
  await db.connect(); await admin.connect();
  await db.query('CREATE TABLE IF NOT EXISTS "RecoveryFixture" (id text primary key, amount integer NOT NULL)');
  await db.query('INSERT INTO "RecoveryFixture" VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET amount=EXCLUDED.amount', ["recovery-proof", 187]);
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname='modelshot_restore_test'");
  if (exists.rowCount) throw new Error("Restore test database already exists; inspect and remove it explicitly before repeating this drill");
  await admin.query('CREATE DATABASE "modelshot_restore_test"');
  run(["pg_dump", "-U", "modelshot", "-d", "modelshot_test", "-Fc", "-f", "/tmp/modelshot-recovery.dump"]);
  run(["pg_restore", "-U", "modelshot", "-d", "modelshot_restore_test", "--exit-on-error", "/tmp/modelshot-recovery.dump"]);
  const restored = new Client({ connectionString: target.toString() }); await restored.connect();
  const proof = await restored.query('SELECT amount FROM "RecoveryFixture" WHERE id=$1', ["recovery-proof"]);
  if (proof.rows[0]?.amount !== 187) throw new Error("Restored balance differs");
  const tables = await restored.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname='public'");
  await restored.end();
  const result = { ok: true, elapsedMs: Date.now() - started, tables: tables.rows[0].count, proof: "Synthetic financial value restored exactly; source database retained" };
  await mkdir("test-results", { recursive: true }); await writeFile("test-results/recovery-drill.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  await admin.query('DROP DATABASE "modelshot_restore_test"');
} finally { await db.query('DROP TABLE IF EXISTS "RecoveryFixture"').catch(() => {}); await db.end(); await admin.end(); }
