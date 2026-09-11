import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.test")) loadEnvFile(".env.test");

function requireLoopback(value, protocols, label) {
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`${label} must use a loopback test service`);
  }
  return url;
}

export function getTestEnvironment(env = process.env) {
  const databaseUrl = env.TEST_DATABASE_URL || "postgresql://modelshot:local-modelshot-only@127.0.0.1:55432/modelshot_test";
  const db = requireLoopback(databaseUrl, ["postgres:", "postgresql:"], "TEST_DATABASE_URL");
  if (db.pathname !== "/modelshot_test") throw new Error("Tests require the dedicated modelshot_test database");
  const redisUrl = env.TEST_REDIS_URL || "redis://127.0.0.1:56379/1";
  const redis = requireLoopback(redisUrl, ["redis:"], "TEST_REDIS_URL");
  if (redis.pathname !== "/1") throw new Error("Tests require Redis database 1");
  const endpoint = env.TEST_S3_ENDPOINT || "http://127.0.0.1:59000";
  requireLoopback(endpoint, ["http:"], "TEST_S3_ENDPOINT");
  const mailUrl = env.TEST_MAIL_URL || "http://127.0.0.1:58025";
  requireLoopback(mailUrl, ["http:"], "TEST_MAIL_URL");
  return {
    databaseUrl,
    redisUrl,
    storage: {
      endpoint,
      region: env.TEST_S3_REGION || "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.TEST_S3_ACCESS_KEY_ID || "modelshot-local",
        secretAccessKey: env.TEST_S3_SECRET_ACCESS_KEY || "local-modelshot-storage-only",
      },
    },
    smtpPort: Number(env.TEST_SMTP_PORT || 51025),
    mailUrl,
  };
}
