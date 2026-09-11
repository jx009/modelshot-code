import { spawnSync } from "node:child_process";
import { getTestEnvironment } from "./environment.mjs";

export default function migrateTestDatabase() {
  const { databaseUrl } = getTestEnvironment();
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    stdio: "inherit",
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) throw new Error("Test migrations failed. Start the local services with npm run infra:up.");
}
