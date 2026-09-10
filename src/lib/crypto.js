import crypto from "crypto";

/**
 * AES-256-GCM 密钥加密（模型通道 API Key 存储用）
 * 主密钥：.env 的 ENCRYPTION_KEY（32 字节 hex 或任意字符串派生）
 * 密文格式：aes:gcm:<iv_hex>:<tag_hex>:<data_hex>
 */

function deriveKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY is not set (generate: openssl rand -hex 32)");
  }
  // hex 64 字符直接用；其他任意字符串派生 32 字节
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes:gcm:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(ciphertext) {
  if (!ciphertext || !ciphertext.startsWith("aes:gcm:")) return null;
  try {
    const [, , ivHex, tagHex, dataHex] = ciphertext.split(":");
    const key = deriveKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null; // 解密失败（密钥轮换后旧密文）——视为未配置，降级 env
  }
}

/**
 * 脱敏显示（API 返回永远用它）：sk-abc1234567890xyz → sk-***xyz
 */
export function maskSecret(secret) {
  if (!secret) return "";
  const s = String(secret);
  if (s.length <= 8) return "***";
  return `${s.slice(0, 3)}***${s.slice(-4)}`;
}

/**
 * 判断配置是否已加密（区分旧明文/新密文）
 */
export function isEncrypted(value) {
  return Boolean(value && value.startsWith("aes:gcm:"));
}
