import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import { getTestEnvironment } from "./environment.mjs";
import { FakeProvider } from "./fake-provider.mjs";
import { createImage } from "../../src/lib/domain/assets/service.js";
import { quoteGeneration, submitGeneration } from "../../src/lib/domain/generation/submission.js";
import { freeCycle } from "../../src/lib/domain/billing/ledger.js";

export async function domainFixture() {
  const environment = getTestEnvironment();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: environment.databaseUrl, max: 25 }) });
  const client = new S3Client(environment.storage);
  const prefix = `domain-${randomUUID()}`;
  const keys = new Set();
  const users = [];
  await client.send(new CreateBucketCommand({ Bucket: prefix }));
  const store = {
    async put(key, body, contentType) { keys.add(key); await client.send(new PutObjectCommand({ Bucket: prefix, Key: key, Body: body, ContentType: contentType })); },
    async get(key) { const row = await client.send(new GetObjectCommand({ Bucket: prefix, Key: key })); return Buffer.from(await row.Body.transformToByteArray()); },
  };
  const provider = new FakeProvider();
  const image = Buffer.from((await provider.generateTryOn({})).imageBase64, "base64");
  const dependencies = {
    resolveProvider: async () => ({ id: "openai", model: "fixture", version: "fixture-1", nativeSizes: ["1024x1024"] }),
    buildPrompt: async () => "Test fixture fashion image",
  };
  return {
    db, store, image, environment,
    async user(credits = 100, quota = 0) {
      const user = await db.user.create({ data: { email: `${prefix}-${users.length}@modelshot.test`, credits } });
      users.push(user.id);
      await db.billingCycle.create({ data: { ...freeCycle(user.id), quota } });
      const asset = await createImage(user.id, image, {}, db, store);
      return { ...user, asset };
    },
    async quote(user, overrides = {}) {
      return quoteGeneration(user.id, { images: [user.asset.id], personImage: user.asset.id, workflowId: "single-shot", ...overrides }, db, dependencies);
    },
    async submit(user, overrides = {}) {
      const quote = await this.quote(user, overrides);
      return submitGeneration(user.id, quote.quoteId, quote.digest, randomUUID(), db);
    },
    async cleanup() {
      const outputs = await db.tryOn.findMany({ where: { userId: { in: users } }, select: { id: true } });
      const ids = outputs.map(row => row.id);
      const exports = await db.exportJob.findMany({ where: { userId: { in: users } }, select: { id: true } });
      const entities = [...ids, ...exports.map(row => row.id)];
      await db.processingStep.deleteMany({ where: { entityId: { in: entities } } });
      await db.outboxEvent.deleteMany({ where: { entityId: { in: entities } } });
      await db.exportJob.deleteMany({ where: { userId: { in: users } } });
      await db.outboxEvent.deleteMany({ where: { entityId: { in: ids } } });
      await db.generationAttempt.deleteMany({ where: { tryOnId: { in: ids } } });
      await db.creditReservation.deleteMany({ where: { userId: { in: users } } });
      await db.assetReference.deleteMany({ where: { asset: { userId: { in: users } } } });
      await db.draft.deleteMany({ where: { userId: { in: users } } });
      await db.project.deleteMany({ where: { userId: { in: users } } });
      await db.tryOn.deleteMany({ where: { userId: { in: users } } });
      await db.batchJob.deleteMany({ where: { userId: { in: users } } });
      await db.generationQuote.deleteMany({ where: { userId: { in: users } } });
      await db.billingCycle.deleteMany({ where: { userId: { in: users } } });
      await db.asset.deleteMany({ where: { userId: { in: users } } });
      await db.creditLot.deleteMany({ where: { userId: { in: users } } });
      await db.commissionAdjustment.deleteMany({ where: { inviterId: { in: users } } });
      await db.inviteCommission.deleteMany({ where: { inviteeId: { in: users } } });
      await db.agentCommissionSettlementLog.deleteMany({ where: { agentId: { in: users } } });
      await db.adminAuditLog.deleteMany({ where: { adminId: { in: users } } });
      await db.order.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      for (const key of keys) await client.send(new DeleteObjectCommand({ Bucket: prefix, Key: key }));
      await client.send(new DeleteBucketCommand({ Bucket: prefix }));
      client.destroy();
      await db.$disconnect();
    },
  };
}
