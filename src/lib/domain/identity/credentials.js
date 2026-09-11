import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

function key(version) {
  const secret = process.env[`ENCRYPTION_KEY_${version}`] || (version === (process.env.ENCRYPTION_KEY_VERSION || "1") ? process.env.ENCRYPTION_KEY : null);
  if (!/^[a-f0-9]{64}$/i.test(secret || "")) throw new Error("Credential encryption key unavailable");
  return Buffer.from(secret, "hex");
}

export function sealCredential(secret, { id, userId, provider }, version = process.env.ENCRYPTION_KEY_VERSION || "1") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(version), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([id, userId, provider, version])));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext: [iv, cipher.getAuthTag(), encrypted].map(v => v.toString("base64url")).join("."), keyVersion: version };
}

export function openCredential(record) {
  if (record.status !== "active") throw new AppError("CREDENTIAL_REVOKED", 409);
  const [iv, tag, encrypted] = record.ciphertext.split(".").map(v => Buffer.from(v, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(record.keyVersion), iv);
  decipher.setAAD(Buffer.from(JSON.stringify([record.id, record.userId, record.provider, record.keyVersion])));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function saveCredential(userId, provider, secret, db = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const existing = await tx.providerCredential.findUnique({ where: { userId_provider: { userId, provider } } });
    const id = existing?.id || randomUUID();
    const data = { ...sealCredential(secret, { id, userId, provider }), mask: `****${secret.slice(-4)}`, status: "active" };
    return tx.providerCredential.upsert({ where: { userId_provider: { userId, provider } }, create: { id, userId, provider, ...data }, update: data,
      select: { id: true, provider: true, mask: true, status: true, updatedAt: true } });
  });
}
