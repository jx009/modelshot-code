import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteBucketCommand } from "@aws-sdk/client-s3";
import { getTestEnvironment } from "../support/environment.mjs";
import { issueChallenge, changeIdentity } from "../../src/lib/domain/identity/verification.js";
import { rateLimit } from "../../src/lib/domain/identity/rate-limit.js";
import { createImage, ownedAsset, readOwnedImage } from "../../src/lib/domain/assets/service.js";

const env = getTestEnvironment();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.databaseUrl }) });
const prefix = `m1-${randomUUID()}`;
const email = `${prefix}@modelshot.test`;
const client = new S3Client(env.storage);
const bucket = prefix;
const keys = [];
const store = {
  async put(key, body, type) { keys.push(key); await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type })); },
  async get(key) { const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); return Buffer.from(await response.Body.transformToByteArray()); },
};

beforeAll(async () => {
  vi.stubEnv("NEXTAUTH_SECRET", "identity-fixture-secret-at-least-32-characters");
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
});
afterAll(async () => {
  const users = await db.user.findMany({ where: { email: { startsWith: prefix } }, select: { id: true } });
  await db.asset.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
  await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
  await db.verificationCode.deleteMany({ where: { email: { startsWith: prefix } } });
  for (const key of keys) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  client.destroy();
  await db.$disconnect();
  vi.unstubAllEnvs();
});

it("serializes challenge issuance and consumes a code only once under concurrent registration", async () => {
  const issued = await Promise.allSettled(Array.from({ length: 8 }, () => issueChallenge(email, "REGISTER", db)));
  const successes = issued.filter(result => result.status === "fulfilled");
  expect(successes).toHaveLength(1);
  const code = successes[0].value.code;
  const record = await db.verificationCode.findUnique({ where: { email_purpose: { email, purpose: "REGISTER" } } });
  expect(record.digest).not.toContain(code);
  expect(record).not.toHaveProperty("code");
  const registered = await Promise.allSettled(Array.from({ length: 4 }, () => changeIdentity({ email, password: "Strong-fixture-password!", code }, "REGISTER", db)));
  expect(registered.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.user.count({ where: { email } })).toBe(1);
});

it("commits failed attempts and blocks the valid code after five failures", async () => {
  const address = `${prefix}-fail@modelshot.test`;
  const { code } = await issueChallenge(address, "REGISTER", db);
  const wrong = code === "123456" ? "654321" : "123456";
  await Promise.allSettled(Array.from({ length: 8 }, () => changeIdentity({ email: address, password: "Strong-fixture-password!", code: wrong }, "REGISTER", db)));
  expect((await db.verificationCode.findUnique({ where: { email_purpose: { email: address, purpose: "REGISTER" } } })).attempts).toBe(5);
  await expect(changeIdentity({ email: address, password: "Strong-fixture-password!", code }, "REGISTER", db)).rejects.toThrow("CODE_INVALID");
});

it("atomically changes the password and revokes old sessions", async () => {
  const { code } = await issueChallenge(email, "RESET_PASSWORD", db);
  await changeIdentity({ email, password: "New-fixture-password!", code }, "RESET_PASSWORD", db);
  expect((await db.user.findUnique({ where: { email } })).sessionVersion).toBe(1);
  await expect(changeIdentity({ email, password: "Other-fixture-password!", code }, "RESET_PASSWORD", db)).rejects.toThrow("CODE_INVALID");
});

it("enforces the rate limit atomically across concurrent requests", async () => {
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => rateLimit("fixture", prefix, 5, 60, db)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(5);
});

it("stores a normalized private asset and rejects another owner", async () => {
  const user = await db.user.findUnique({ where: { email } });
  const input = await sharp({ create: { width: 24, height: 32, channels: 3, background: "green" } }).jpeg().toBuffer();
  const asset = await createImage(user.id, input, { declaredType: "image/jpeg" }, db, store);
  expect(asset.contentType).toBe("image/png");
  expect((await sharp(await readOwnedImage(user.id, asset.id, db, store)).metadata()).format).toBe("png");
  await expect(ownedAsset("another-owner", asset.id, db)).rejects.toThrow("ASSET_NOT_FOUND");
  expect((await fetch(`${env.storage.endpoint}/${bucket}/${asset.objectKey}`)).status).toBe(403);
});
