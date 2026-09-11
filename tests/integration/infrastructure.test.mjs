import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Queue, QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";
import { getTestEnvironment } from "../support/environment.mjs";
import { FakeProvider } from "../support/fake-provider.mjs";

const config = getTestEnvironment();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
const runId = randomUUID();
const email = `integration-${runId}@modelshot.local`;

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => {
  try { await prisma.user.deleteMany({ where: { email } }); }
  finally { await prisma.$disconnect(); }
});

describe("local database contract", () => {
  it("applies the application schema and rolls back a failed transaction", async () => {
    await expect(prisma.$transaction(async tx => {
      await tx.user.create({ data: { email, credits: 100 } });
      throw new Error("simulated transaction interruption");
    })).rejects.toThrow("simulated transaction interruption");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
  it("enforces unique identity under concurrent writes", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => prisma.user.create({ data: { email } })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter(result => result.status === "rejected")) expect(result.reason.code).toBe("P2002");
  });
});

it("persists a queued request before a worker starts and retries a rejected call", async () => {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const name = `m0-${runId}`;
  const queue = new Queue(name, { connection });
  const events = new QueueEvents(name, { connection });
  const provider = new FakeProvider(["rate_limit", "success"]);
  let worker;
  try {
    await events.waitUntilReady();
    const job = await queue.add("generate", { idempotencyKey: runId }, { jobId: runId, attempts: 2, backoff: { type: "fixed", delay: 20 } });
    await queue.add("generate", { idempotencyKey: runId }, { jobId: runId });
    expect(await queue.getWaitingCount()).toBe(1);
    worker = new Worker(name, job => provider.generateTryOn(job.data), { connection });
    const result = await job.waitUntilFinished(events, 15_000);
    expect(result.state).toBe("succeeded");
    expect((await queue.getJob(job.id)).attemptsMade).toBe(2);
  } finally {
    await worker?.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  }
});

it("stores a real image privately and denies anonymous reads", async () => {
  const client = new S3Client(config.storage);
  const bucket = `modelshot-test-${runId}`;
  const key = "fixture.png";
  let created = false;
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    created = true;
    const result = await new FakeProvider().generateTryOn({});
    const body = Buffer.from(result.imageBase64, "base64");
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "image/png" }));
    const stored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    expect(Buffer.from(await stored.Body.transformToByteArray())).toEqual(body);
    expect(stored.ContentType).toBe("image/png");
    const anonymous = await fetch(`${config.storage.endpoint}/${bucket}/${key}`, { signal: AbortSignal.timeout(5000) });
    expect(anonymous.status).toBe(403);
  } finally {
    if (created) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    client.destroy();
  }
});

it("delivers a verification fixture to the local mail catcher", async () => {
  const subject = `M0 fixture ${runId}`;
  const transport = nodemailer.createTransport({ host: "127.0.0.1", port: config.smtpPort, secure: false, connectionTimeout: 5000 });
  try {
    await transport.sendMail({ from: "noreply@modelshot.local", to: email, subject, text: "Test verification code: 123456" });
    const response = await fetch(`${config.mailUrl}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`, { signal: AbortSignal.timeout(5000) });
    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.messages.some(message => message.Subject === subject)).toBe(true);
    for (const message of result.messages.filter(message => message.Subject === subject)) {
      const removed = await fetch(`${config.mailUrl}/api/v1/messages`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ IDs: [message.ID] }) });
      expect(removed.ok).toBe(true);
    }
  } finally { transport.close(); }
});
