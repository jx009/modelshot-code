import { prisma } from "./prisma";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";

/**
 * 站点配置服务（SMTP / Google OAuth / Stripe）
 * 读取顺序：DB（SystemConfig，60s 缓存）> env 兜底
 * 敏感 key（*_pass / *_secret）DB 存 AES-256-GCM 密文，读取自动解密
 */

// key 常量 + 元信息（env 兜底名 + 是否敏感）
export const CONFIG_KEYS = {
  smtp_host:             { env: "SMTP_HOST",             sensitive: false },
  smtp_port:             { env: "SMTP_PORT",             sensitive: false },
  smtp_user:             { env: "SMTP_USER",             sensitive: false },
  smtp_pass:             { env: "SMTP_PASS",             sensitive: true },
  smtp_from:             { env: "SMTP_FROM",             sensitive: false },
  google_client_id:      { env: "GOOGLE_CLIENT_ID",      sensitive: false },
  google_client_secret:  { env: "GOOGLE_CLIENT_SECRET",  sensitive: true },
  stripe_secret_key:     { env: "STRIPE_SECRET_KEY",     sensitive: true },
  stripe_publishable_key:{ env: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", sensitive: false },
  stripe_webhook_secret: { env: "STRIPE_WEBHOOK_SECRET", sensitive: true },
};

// 缓存（60s；set 后清空）
let cache = new Map();
let cacheAt = 0;
const TTL = 60_000;

export function invalidateSiteConfig() {
  cache = new Map();
  cacheAt = 0;
}

/** 单 key 读取：DB > env；敏感项自动解密；null 表示未配置 */
export async function getSiteConfig(key) {
  const meta = CONFIG_KEYS[key];
  if (!meta) throw new Error(`Unknown config key: ${key}`);

  if (cache.has(key) && Date.now() - cacheAt < TTL) return cache.get(key);

  let value = null;
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (row?.value != null && row.value !== "") {
      value = meta.sensitive && row.value.startsWith("aes:gcm:") ? decryptSecret(row.value) : row.value;
    }
  } catch (err) {
    console.warn(`[SiteConfig] DB lookup failed for ${key}:`, err.message);
  }
  // env 兜底（DB 未配置时）
  if (value == null) {
    const envVal = process.env[meta.env];
    // 占位文字视为未配置
    if (envVal && envVal.trim() && !envVal.includes("待填")) value = envVal.trim();
  }
  cache.set(key, value);
  cacheAt = Date.now();
  return value;
}

/** 批量读取（一次缓存周期内） */
export async function getSiteConfigs(keys) {
  const entries = await Promise.all(keys.map(async k => [k, await getSiteConfig(k)]));
  return Object.fromEntries(entries);
}

/**
 * 写入（admin settings 页调用）：敏感 key 加密；value 为 null/空 删除记录（回退 env）
 * @returns 脱敏视图
 */
export async function setSiteConfig(key, value) {
  const meta = CONFIG_KEYS[key];
  if (!meta) throw new Error(`Unknown config key: ${key}`);

  if (value == null || String(value).trim() === "") {
    await prisma.systemConfig.deleteMany({ where: { key } });
  } else {
    const v = String(value).trim();
    const stored = meta.sensitive ? encryptSecret(v) : v;
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: stored },
      create: { key, value: stored },
    });
  }
  invalidateSiteConfig();
  return { key, masked: value ? maskSecret(String(value)) : "" };
}

/** 管理页视图：全部 key 的状态（是否来自 DB、脱敏值）——永不回明文 */
export async function getSiteConfigView() {
  const rows = await prisma.systemConfig.findMany().catch(() => []);
  const dbMap = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return Object.entries(CONFIG_KEYS).map(([key, meta]) => {
    const dbValue = dbMap[key] ?? null;
    const inDb = dbValue != null && dbValue !== "";
    const actual = inDb
      ? (meta.sensitive && dbValue.startsWith("aes:gcm:") ? decryptSecret(dbValue) : dbValue)
      : null;
    const envVal = process.env[meta.env];
    const envOk = envVal && envVal.trim() && !envVal.includes("待填");
    return {
      key,
      sensitive: meta.sensitive,
      source: inDb ? "db" : envOk ? "env" : "none",
      // 敏感项只回脱敏；非敏感回原值（host/id 类不敏感）
      display: actual != null ? (meta.sensitive ? maskSecret(actual) : actual) : (envOk ? (meta.sensitive ? maskSecret(envVal) : envVal) : ""),
    };
  });
}
