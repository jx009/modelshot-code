// 一次性脚本：完成卡在“正在切换配置”的 COS 换桶迁移。不改线上代码，在 worker 容器里运行。
// 默认只预览（不写任何数据）；确认无误后加 APPLY=1 再跑一次才真正切换。
// 用法（宿主机）：
//   docker exec -i modelshot-worker-1 node --input-type=module < /root/finish-cos-migration.mjs
//   docker exec -i -e APPLY=1 modelshot-worker-1 node --input-type=module < /root/finish-cos-migration.mjs
import { prisma } from "/app/src/lib/prisma.js";
import { getSiteConfig, setSiteConfig, invalidateSiteConfig } from "/app/src/lib/site-config.js";
import { getCosConfig, cosTargetId } from "/app/src/lib/infra/storage/cos-config.js";
import { qrTarget } from "/app/src/lib/server/announcement-qr.js";

const apply = process.env.APPLY === "1";
const fail = message => { console.error(`中止：${message}`); process.exitCode = 1; };

async function main() {
  const raw = await getSiteConfig("cos_migration");
  const state = raw ? JSON.parse(raw) : null;
  if (!state) return fail("没有找到迁移记录。");
  if (state.status !== "switching") return fail(`迁移状态是 ${state.status}，不是“切换中”，不需要这个脚本。`);
  const config = await getCosConfig();
  if (cosTargetId(config) !== state.source.targetId) return fail("当前 COS 配置和迁移开始时不一致（密钥或前缀被改过），为安全起见不切换。");

  const { source, target } = state;
  const nextConfig = { ...config, bucket: target.bucket, region: target.region };
  const nextTargetId = cosTargetId(nextConfig);
  const oldPrefix = `cos://${source.bucket}/${source.region}/`;
  const newPrefix = `cos://${target.bucket}/${target.region}/`;
  const offset = oldPrefix.length + 1;
  const oldQr = qrTarget(config), newQr = qrTarget(nextConfig);

  const pinned = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "Asset" WHERE "objectKey" LIKE ${`${oldPrefix}%`}`;
  const samples = await prisma.$queryRaw`
    SELECT "objectKey" AS old, ${newPrefix}::text || substr("objectKey", ${offset}::integer) AS new
    FROM "Asset" WHERE "objectKey" LIKE ${`${oldPrefix}%`} LIMIT 3`;
  const receipts = await prisma.assetDelivery.count({ where: { targetId: source.targetId } });
  const uploads = await prisma.assetUpload.count({ where: { targetId: source.targetId } });
  const announcements = await prisma.systemConfig.findUnique({ where: { key: "announcements" } });
  const qrHits = announcements?.value ? announcements.value.split(oldQr).length - 1 : 0;

  console.log(`旧桶：${source.bucket}（${source.region}）  →  新桶：${target.bucket}（${target.region}）`);
  console.log(`要改写路径的原图：${pinned[0].n} 条`);
  for (const row of samples) console.log(`  ${row.old}\n  → ${row.new}`);
  if (samples.some(row => !row.new || !row.new.startsWith(newPrefix))) return fail("预览出的新路径不正确，不切换。请把上面的输出发给开发者。");
  console.log(`要挂到新桶的预览图记录：${receipts} 条`);
  console.log(`要作废的未完成直传：${uploads} 条`);
  console.log(`要更新的公告二维码：${qrHits} 处`);

  if (!apply) { console.log("\n以上只是预览，没有写入任何数据。确认无误后加 APPLY=1 再运行一次。"); return; }

  const result = await prisma.$transaction(async tx => {
    const moved = await tx.$executeRaw`
      UPDATE "Asset" SET "objectKey" = ${newPrefix}::text || substr("objectKey", ${offset}::integer)
      WHERE "objectKey" LIKE ${`${oldPrefix}%`}`;
    const rows = await tx.assetDelivery.findMany({ where: { targetId: source.targetId } });
    if (rows.length) {
      await tx.assetDelivery.deleteMany({ where: { targetId: nextTargetId } });
      await tx.assetDelivery.createMany({
        data: rows.map(row => ({ assetId: row.assetId, targetId: nextTargetId, variant: row.variant, objectKey: row.objectKey, readyAt: row.readyAt })),
        skipDuplicates: true,
      });
      await tx.assetDelivery.deleteMany({ where: { targetId: source.targetId } });
    }
    const dropped = await tx.assetUpload.deleteMany({ where: { targetId: source.targetId } });
    const notice = await tx.systemConfig.findUnique({ where: { key: "announcements" } });
    if (notice?.value?.includes(oldQr)) await tx.systemConfig.update({ where: { key: "announcements" }, data: { value: notice.value.split(oldQr).join(newQr) } });
    await setSiteConfig("cos_delivery", JSON.stringify(nextConfig), tx);
    const done = { ...state, status: "done", phase: "done", cursor: null, error: null, finishedAt: new Date().toISOString() };
    await tx.systemConfig.upsert({ where: { key: "cos_migration" }, update: { value: JSON.stringify(done) }, create: { key: "cos_migration", value: JSON.stringify(done) } });
    return { moved, receipts: rows.length, uploads: dropped.count };
  }, { timeout: 60_000 });
  invalidateSiteConfig();
  console.log(`\n切换完成：改写 ${result.moved} 条原图路径，迁移 ${result.receipts} 条预览图记录，作废 ${result.uploads} 条未完成直传。`);
  console.log("现在线上已经读新桶。请去 CDN 控制台把回源改成新桶，然后重启 web 容器让缓存的旧配置立即失效。");
}

try { await main(); }
catch (error) { console.error("出错（事务已回滚，数据没有改动）：", error?.message || error); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
