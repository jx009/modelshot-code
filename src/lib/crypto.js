import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(version) {
  const secret = process.env[`ENCRYPTION_KEY_${version}`] || (version === (process.env.ENCRYPTION_KEY_VERSION || "1") ? process.env.ENCRYPTION_KEY : null);
  if (!/^[a-f0-9]{64}$/i.test(secret || "")) throw new Error("Configuration encryption key unavailable");
  return Buffer.from(secret, "hex");
}

function aad(version) {
  return Buffer.from(JSON.stringify(["platform", "system", "configuration", version]));
}

export function encryptSecret(plaintext) {
  const version = process.env.ENCRYPTION_KEY_VERSION || "1";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(version), iv);
  cipher.setAAD(aad(version));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const ciphertext = [iv, cipher.getAuthTag(), encrypted].map(value => value.toString("base64url")).join(".");
  return `vault:${version}:${ciphertext}`;
}
export function decryptSecret(ciphertext) {
  if (!ciphertext) return null;
  if (!isEncrypted(ciphertext)) throw new Error("Unsupported encrypted configuration");
  const [, keyVersion, value] = ciphertext.split(":");
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(keyVersion), iv);
  decipher.setAAD(aad(keyVersion));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
export function maskSecret(secret) { return secret ? `****${String(secret).slice(-4)}` : ""; }
export function isEncrypted(value) { return typeof value === "string" && /^vault:[^:]+:[^:]+$/.test(value); }
