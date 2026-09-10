import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { UserService } from "../src/lib/services/user.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 测试用户：free 套餐（10张/月），credits=100
const user = await prisma.user.upsert({
  where: { email: "concurrency-test@modelshot.local" },
  update: { credits: 100, plan: "free" },
  create: { email: "concurrency-test@modelshot.local", name: "ConcTest", credits: 100 },
});
await prisma.creditTransaction.deleteMany({ where: { userId: user.id } });

// ===== 第一步：并发 15 个消费（free 额度 10 张 + 积分可买 5 张 = 15）
// 期望：15 个全成功 = 10 走 subscription + 5 走 credits；再并发 1 个 → 拒绝
const r1 = await Promise.allSettled(
  Array.from({ length: 15 }, () => UserService.consumeGeneration(user.id))
);
const ok1 = r1.filter(r => r.status === "fulfilled").length;
const r2 = await Promise.allSettled([UserService.consumeGeneration(user.id)]);
const ok2 = r2.filter(r => r.status === "fulfilled").length;

const after = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
const subTx = await prisma.creditTransaction.count({ where: { userId: user.id, type: "consume", channel: "subscription" } });
const credTx = await prisma.creditTransaction.count({ where: { userId: user.id, type: "consume", channel: "credits" } });

console.log("── 并发测试（额度10 + 积分够5张）──");
console.log("前15个成功:", ok1, "| 第16个成功:", ok2, "(应为15/0)");
console.log("余额:", after.credits, "(应为 100-90=10，非负)");
console.log("流水: subscription", subTx, "+ credits", credTx, "(应为10+5)");

// ===== 第二步：退款测试（credits 通道退积分，幂等）
const creditTx = await prisma.creditTransaction.findFirst({
  where: { userId: user.id, type: "consume", channel: "credits" },
});
await prisma.creditTransaction.update({
  where: { id: creditTx.id },
  data: { tryOnId: "fake_refund_test" },
});
await UserService.refundGeneration(user.id, "fake_refund_test");
const afterRefund = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
await UserService.refundGeneration(user.id, "fake_refund_test"); // 幂等重试
const afterRefund2 = await prisma.user.findUnique({ where: { id: user.id }, select: { credits: true } });
console.log("── 退款测试 ──");
console.log("退款后余额:", afterRefund.credits, "(应为 10+18=28)");
console.log("重复退款后:", afterRefund2.credits, "(应仍为 28)");

// ===== 第三步：月用量聚合（含退款抵消）
const usage = await UserService.getMonthUsage(user.id);
console.log("── 聚合测试 ──");
console.log("本月额度用量:", usage, "(10 消费 - 0 退款 = 10)");

const pass =
  ok1 === 15 && ok2 === 0 && after.credits === 10 &&
  subTx === 10 && credTx === 5 &&
  afterRefund.credits === 28 && afterRefund2.credits === 28 && usage === 10;
console.log(pass ? "✅ 全部 PASS" : "❌ FAIL");

// 清理
await prisma.creditTransaction.deleteMany({ where: { userId: user.id } });
await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
await prisma.$disconnect();
