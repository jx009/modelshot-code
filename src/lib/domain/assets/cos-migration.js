import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";
import { getSiteConfig, setSiteConfig, invalidateSiteConfig } from "../../site-config.js";
import { AppError } from "../../http.js";
import { getCosConfig, cosTargetId } from "../../infra/storage/cos-config.js";
import { cosStorage } from "../../infra/storage/cos.js";
import { qrTarget } from "../../server/announcement-qr.js";

/**
 * 更换 COS 桶/地域的在线迁移（通用能力，桶名由管理员在后台填写）。
 *
 * 约束：图片的 primary key 可能写成 `cos://<bucket>/<region>/<key>`，
 * `primaryCos()` 会拒绝桶与当前配置不一致的 key（COS_PRIMARY_BUCKET_CHANGED），
 * 所以不能"先改配置、再搬对象"。顺序是：
 *   1. 复制：按前缀列举旧桶对象，逐个复制到新桶。配置不变，线上照常读旧桶。
 *      列举旧桶而不是遍历数据库，原图、预览图、灵感图、公告二维码一并覆盖。
 *   2. 补齐：再列举一遍，只复制迁移开始后新写入的对象。
 *   3. 切换：一个事务里改写带桶名的 key、搬迁预览图回执、更新二维码目标、切换配置。
 * 游标持久化在 cos_migration，worker 重启后接着跑；失败或取消都不改配置。
 */

const STATE_KEY = "cos_migration";
const PAGE = 200;
// 切换是单事务，失败会整体回滚；失败后按轮询自动重试，超过次数才判定失败。
const SWITCH_ATTEMPTS = 5;

const targetOf = config => ({ bucket: config.bucket, region: config.region, prefix: config.prefix, targetId: cosTargetId(config) });

export function migrationView(state, config) {
  if (!state) return { active: false, current: config ? targetOf(config) : null };
  const { id, status, phase, source, target, estimate, copied, skipped, error, startedAt, finishedAt } = state;
  const active = status === "running" || status === "switching";
  // 列举前不知道对象总数，按数据库估算；完成前最多显示 99%。
  const percent = status === "done" ? 100 : estimate ? Math.min(99, Math.round((copied || 0) / estimate * 100)) : 0;
  return { active, id, status, phase: phase || "copy", source, target, estimate: estimate || 0, copied: copied || 0, skipped: skipped || 0, percent, error: error || null, startedAt, finishedAt: finishedAt || null };
}

export async function getMigrationState(db = prisma) {
  const raw = await getSiteConfig(STATE_KEY, db);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function saveState(state, db = prisma) {
  const value = JSON.stringify(state);
  await db.systemConfig.upsert({ where: { key: STATE_KEY }, update: { value }, create: { key: STATE_KEY, value } });
  invalidateSiteConfig();
}

export function isMigrating(state) {
  return Boolean(state && ["running", "switching"].includes(state.status));
}

/** 改写钉在旧桶上的 key；相对 key 不含桶名，天然可迁移，原样返回。 */
export function retargetKey(value, source, target) {
  if (typeof value !== "string" || !value.startsWith("cos://")) return value;
  const old = `cos://${source.bucket}/${source.region}/`;
  return value.startsWith(old) ? `cos://${target.bucket}/${target.region}/${value.slice(old.length)}` : value;
}

/** 优先服务端复制（不经过本机带宽）；失败时退回下载再上传，跨地域或权限受限时都能完成。 */
export async function copyObject(sourceStore, targetStore, key) {
  try {
    await targetStore.copyFrom(sourceStore, key);
    return "server";
  } catch {
    const headers = await sourceStore.head(key);
    const bytes = await sourceStore.get(key);
    await targetStore.put(key, bytes, headers?.["content-type"] || "application/octet-stream");
    return "relay";
  }
}

export async function startMigration(input, { db = prisma, config } = {}) {
  config ||= await getCosConfig(db);
  if (!config.enabled || !config.bucket) throw new AppError("COS_DISABLED", 409);
  if (input.bucket === config.bucket && input.region === config.region) throw new AppError("COS_MIGRATION_NOOP", 409);
  const existing = await getMigrationState(db);
  if (isMigrating(existing)) throw new AppError("COS_MIGRATION_BUSY", 409);
  // 估算对象数：每张图最多一份原图 + 三个尺寸的预览。只用于显示进度。
  const assets = await db.asset.count({ where: { status: { not: "purged" } } });
  const deliveries = await db.assetDelivery.count({ where: { targetId: cosTargetId(config) } });
  const state = {
    id: randomUUID(), status: "running", phase: "copy",
    source: targetOf(config),
    target: { bucket: input.bucket, region: input.region, prefix: config.prefix },
    estimate: Math.max(1, assets + deliveries), copied: 0, skipped: 0, cursor: null, error: null,
    startedAt: new Date().toISOString(),
  };
  await saveState(state, db);
  return migrationView(state, config);
}

export async function cancelMigration({ db = prisma, config } = {}) {
  const state = await getMigrationState(db);
  if (!isMigrating(state)) throw new AppError("COS_MIGRATION_NOT_RUNNING", 409);
  const next = { ...state, status: "failed", error: "CANCELLED", finishedAt: new Date().toISOString() };
  await saveState(next, db);
  return migrationView(next, config);
}

/**
 * 推进一页。返回 remaining=true 表示还有下一页。
 * copy 阶段复制全部对象；catchup 阶段只复制 startedAt 之后写入的对象；两阶段都结束后切换。
 */
export async function migrateBatch({ db = prisma, config, sourceStore, targetStore } = {}) {
  const state = await getMigrationState(db);
  if (!state || !isMigrating(state)) return { active: false, remaining: false };
  config ||= await getCosConfig(db);
  // 复制已完成、切换失败过：只重试切换，不再重复复制对象。
  if (state.status === "switching") return trySwitch(state, config, db);
  // 迁移期间配置被改过（换密钥、换前缀）就中止，避免复制到错误的位置。
  if (cosTargetId(config) !== state.source.targetId) {
    await saveState({ ...state, status: "failed", error: "CONFIG_CHANGED", finishedAt: new Date().toISOString() }, db);
    return { active: false, remaining: false };
  }
  sourceStore ||= cosStorage(config);
  targetStore ||= cosStorage({ ...config, bucket: state.target.bucket, region: state.target.region });

  const page = await sourceStore.list(`${config.prefix}/`, state.cursor, PAGE);
  const since = state.phase === "catchup" ? Date.parse(state.startedAt) - 60_000 : null;
  let copied = 0, skipped = 0;
  for (const object of page.contents) {
    if (since !== null && Date.parse(object.lastModified) < since) { skipped++; continue; }
    await copyObject(sourceStore, targetStore, object.key);
    copied++;
  }
  const next = { ...state, cursor: page.nextMarker, copied: (state.copied || 0) + copied, skipped: (state.skipped || 0) + skipped };
  if (page.nextMarker) {
    await saveState(next, db);
    return { active: true, remaining: true, copied };
  }
  if (state.phase !== "catchup") {
    // 全量复制完成，再从头扫一遍，补上迁移过程中新写入的对象。
    await saveState({ ...next, phase: "catchup", cursor: null }, db);
    return { active: true, remaining: true, copied };
  }
  const switching = { ...next, status: "switching", phase: "switch", switchAttempts: 0 };
  await saveState(switching, db);
  return { ...(await trySwitch(switching, config, db)), copied };
}

async function trySwitch(state, config, db) {
  try {
    const result = await switchConfig({ state, config, db });
    return { active: false, remaining: false, result };
  } catch (error) {
    // 事务已回滚，配置和数据都没变；记录原因，下一轮再试，次数用尽才标记失败。
    const attempts = (state.switchAttempts || 0) + 1;
    const message = String(error?.message || error).replace(/\s+/g, " ").slice(0, 300);
    const failed = attempts >= SWITCH_ATTEMPTS;
    await saveState({ ...state, switchAttempts: attempts, error: `SWITCH_FAILED: ${message}`,
      ...(failed ? { status: "failed", finishedAt: new Date().toISOString() } : {}) }, db);
    console.error(JSON.stringify({ code: "COS_MIGRATION_SWITCH_FAILED", attempts, message }));
    return { active: !failed, remaining: false, error: message };
  }
}

/** 单事务切换：key 改写、预览图回执搬迁、直传回执作废、二维码目标更新、配置切换。 */
export async function switchConfig({ state, config, db = prisma }) {
  const { source, target } = state;
  const nextConfig = { ...config, bucket: target.bucket, region: target.region };
  const nextTargetId = cosTargetId(nextConfig);
  const oldPrefix = `cos://${source.bucket}/${source.region}/`;
  const newPrefix = `cos://${target.bucket}/${target.region}/`;
  const oldQr = qrTarget(config), newQr = qrTarget(nextConfig);

  const result = await db.$transaction(async tx => {
    // 1. 改写钉在旧桶上的原图 key。
    // 用 substr 且显式转 integer：参数无类型时 substring(x from $n) 会被解析成正则版本，
    // 匹配不到返回 NULL，拼接后整列变 NULL。substr 只有整数版本，不存在这种歧义。
    const moved = await tx.$executeRaw`
      UPDATE "Asset" SET "objectKey" = ${newPrefix}::text || substr("objectKey", ${oldPrefix.length + 1}::integer)
      WHERE "objectKey" LIKE ${`${oldPrefix}%`}`;
    // 2. 预览图对象已在新桶，同一 key；回执改挂到新 targetId，否则会被当作未生成而重新生成。
    const receipts = await tx.assetDelivery.findMany({ where: { targetId: source.targetId } });
    if (receipts.length) {
      await tx.assetDelivery.deleteMany({ where: { targetId: nextTargetId } });
      await tx.assetDelivery.createMany({
        data: receipts.map(row => ({ assetId: row.assetId, targetId: nextTargetId, variant: row.variant, objectKey: row.objectKey, readyAt: row.readyAt })),
        skipDuplicates: true,
      });
      await tx.assetDelivery.deleteMany({ where: { targetId: source.targetId } });
    }
    // 3. 未完成的浏览器直传签名指向旧桶，作废后客户端会重新申请。
    const uploads = await tx.assetUpload.deleteMany({ where: { targetId: source.targetId } });
    // 4. 公告二维码的目标哈希包含桶名，换成新桶的值，否则二维码会被判定为存储已更换。
    const announcements = await tx.systemConfig.findUnique({ where: { key: "announcements" } });
    if (announcements?.value?.includes(oldQr)) {
      await tx.systemConfig.update({ where: { key: "announcements" }, data: { value: announcements.value.split(oldQr).join(newQr) } });
    }
    await setSiteConfig("cos_delivery", JSON.stringify(nextConfig), tx);
    return { moved, deliveryRows: receipts.length, uploads: uploads.count };
  }, { timeout: 60_000 });

  const done = { ...state, status: "done", phase: "done", cursor: null, error: null, finishedAt: new Date().toISOString() };
  await saveState(done, db);
  invalidateSiteConfig();
  return { status: "done", ...result };
}
