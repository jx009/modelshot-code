import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { operationalSnapshot } from "../src/lib/domain/operations.js";
import { reconcileLedger } from "../src/lib/domain/billing/reconciliation.js";
import { recoverWork } from "../src/lib/domain/generation/recovery.js";
import { cleanupStorage, cleanupOrphans } from "../src/lib/domain/assets/lifecycle.js";
import { openCredential, sealCredential } from "../src/lib/domain/identity/credentials.js";
import { decryptSecret, encryptSecret } from "../src/lib/crypto.js";
import { auditedOperation } from "../src/lib/domain/identity/admin-operation.js";
import { randomUUID } from "node:crypto";

const [command, actorId, reason] = process.argv.slice(2);
try {
  let result;
  if (command === "status") result = await operationalSnapshot();
  else if (command === "reconcile") { result = await reconcileLedger(); if (!result.ok) process.exitCode = 1; }
  else if (command === "recover") result = await recoverWork();
  else if (command === "cleanup") result = await cleanupStorage();
  else if (command === "cleanup-orphans") result = await cleanupOrphans();
  else if (command === "rotate-keys") result = await auditedOperation(actorId, randomUUID(), "ROTATE_KEYS", { reason }, async tx => {
    const records = await tx.providerCredential.findMany({ where: { status: "active" } });
    for (const row of records) await tx.providerCredential.update({ where: { id: row.id }, data: sealCredential(openCredential(row), row) });
    const providers = await tx.modelProvider.findMany();
    for (const row of providers) { const config = JSON.parse(row.config || "{}"); if (config.apiKeyEnc) { config.apiKeyEnc = encryptSecret(decryptSecret(config.apiKeyEnc)); await tx.modelProvider.update({ where: { id: row.id }, data: { config: JSON.stringify(config) } }); } }
    const configs = await tx.systemConfig.findMany({ where: { value: { startsWith: "vault:" } } });
    for (const row of configs) await tx.systemConfig.update({ where: { key: row.key }, data: { value: encryptSecret(decryptSecret(row.value)) } });
    return { audit: { credentials: records.length, version: process.env.ENCRYPTION_KEY_VERSION || "1" } };
  }, prisma, "root");
  else throw new Error("Usage: npm run ops -- status|reconcile|recover|cleanup|rotate-keys [rootUserId] [reason]");
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ code: error.code || "OPERATION_FAILED", type: error.name })); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
