import { sealCredential, openCredential } from "./domain/identity/credentials.js";

const identity = { id: "platform", userId: "system", provider: "configuration" };
export function encryptSecret(plaintext) {
  const sealed = sealCredential(plaintext, identity);
  return `vault:${sealed.keyVersion}:${sealed.ciphertext}`;
}
export function decryptSecret(ciphertext) {
  if (!ciphertext) return null;
  if (!isEncrypted(ciphertext)) throw new Error("Unsupported encrypted configuration");
  const [, keyVersion, value] = ciphertext.split(":");
  return openCredential({ ...identity, status: "active", keyVersion, ciphertext: value });
}
export function maskSecret(secret) { return secret ? `****${String(secret).slice(-4)}` : ""; }
export function isEncrypted(value) { return typeof value === "string" && /^vault:[^:]+:[^:]+$/.test(value); }
