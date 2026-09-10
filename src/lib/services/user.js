import { prisma } from "../prisma.js";

/**
 * 订阅套餐配置（方案 Step 9：订阅制 + 积分制双轨）
 * 订阅内不扣积分；超出走积分（18 积分/张）
 */
export const SUBSCRIPTION_PLANS = {
  free: { id: "free", name: "免费版", monthlyQuota: 10, priceCny: 0, priceUsd: 0 },
  standard: { id: "standard", name: "标准版", monthlyQuota: 300, priceCny: 199, priceUsd: 29 },
  pro: { id: "pro", name: "专业版", monthlyQuota: 1500, priceCny: 599, priceUsd: 99 },
};

const CREDIT_COST_PER_IMAGE = 18;

/**
 * 构造余额不足错误（携带稳定错误码，前端按码渲染文案）
 */
function insufficientCreditsError() {
  const err = new Error("Insufficient credits available");
  err.code = "INSUFFICIENT_CREDITS";
  return err;
}

export const UserService = {
  async getCredits(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    return user ? user.credits : 0;
  },

  /**
   * 充值/赠送积分（写流水）
   */
  async addCredits(userId, amount, meta = {}) {
    if (amount <= 0) return;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: amount } },
      }),
      prisma.creditTransaction.create({
        data: {
          userId,
          type: meta.type || "purchase", // purchase | grant
          channel: "credits",
          amount,
          reason: meta.reason || null,
        },
      }),
    ]);
  },

  /**
   * 原子扣积分 — 条件更新下沉到数据库，并发安全
   * updateMany 的 where 带 credits >= amount，DB 层保证不会扣成负数
   */
  async deductCredits(userId, amount) {
    if (amount <= 0) return;
    const result = await prisma.user.updateMany({
      where: { id: userId, credits: { gte: amount } },
      data: { credits: { decrement: amount } },
    });
    if (result.count === 0) {
      throw insufficientCreditsError();
    }
  },

  /** 获取用户当前生效的订阅套餐（过期视为 free） */
  async getActivePlan(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, planExpiresAt: true },
    });
    if (!user) return SUBSCRIPTION_PLANS.free;
    const plan = SUBSCRIPTION_PLANS[user.plan] || SUBSCRIPTION_PLANS.free;
    if (plan.id === "free") return plan;
    if (user.planExpiresAt && user.planExpiresAt < new Date()) {
      return SUBSCRIPTION_PLANS.free; // 过期回落 free
    }
    return plan;
  },

  /** 本月订阅额度已用量（按流水表聚合，refund 自动抵消 consume，可审计） */
  async getMonthUsage(userId) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const agg = await prisma.creditTransaction.aggregate({
      where: {
        userId,
        type: { in: ["consume", "refund"] },
        channel: "subscription",
        createdAt: { gte: monthStart },
      },
      _sum: { amount: true },
    });
    // consume 为 -1、refund 为 +1，sum 即净用量；credits 通道的积分退款不影响此聚合（channel 隔离）
    return Math.abs(agg._sum.amount || 0);
  },

  /**
   * 消费一次生成额度（双轨，事务 + 用户级锁 + 流水）：
   *
   * 并发安全设计：
   * - pg_advisory_xact_lock(userId) 把同一用户的计费串行化——锁内读到的月用量必然是最新值
   *   （修复：并发下额度 check-then-act 超卖——N 个并发全读到 usage=0 时会发出 N 张额度）
   * - 积分通道用条件更新（credits >= amount）保证不透支
   *
   * 流水在此时先记「预扣」，tryOnId 生成后由 linkTransaction 补关联；
   * 生成失败由 refundGeneration 冲销（幂等）。
   *
   * @returns {Promise<{billingType: "subscription"|"credits", creditCost: number}>}
   */
  async consumeGeneration(userId) {
    return prisma.$transaction(async (tx) => {
      // 用户级事务锁：同用户计费串行，锁随事务结束自动释放
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", userId);

      const [user, plan] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { plan: true, planExpiresAt: true, credits: true } }),
        Promise.resolve(null),
      ]);

      // 生效套餐（过期回落 free）
      let activePlan = SUBSCRIPTION_PLANS[user?.plan] || SUBSCRIPTION_PLANS.free;
      if (activePlan.id !== "free" && user?.planExpiresAt && user.planExpiresAt < new Date()) {
        activePlan = SUBSCRIPTION_PLANS.free;
      }

      // 锁内查最新月用量
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const agg = await tx.creditTransaction.aggregate({
        where: {
          userId,
          type: "consume",
          channel: "subscription",
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      });
      const monthUsage = Math.abs(agg._sum.amount || 0);

      // 订阅额度内 → 只写流水不动积分
      if (monthUsage < activePlan.monthlyQuota) {
        const tx1 = await tx.creditTransaction.create({
          data: { userId, type: "consume", channel: "subscription", amount: -1 },
        });
        return { billingType: "subscription", creditCost: 0, txId: tx1.id };
      }

      // 超出 → 原子扣积分（条件更新，绝不透支）+ 流水
      const deducted = await tx.user.updateMany({
        where: { id: userId, credits: { gte: CREDIT_COST_PER_IMAGE } },
        data: { credits: { decrement: CREDIT_COST_PER_IMAGE } },
      });
      if (deducted.count === 0) {
        throw insufficientCreditsError();
      }
      const tx2 = await tx.creditTransaction.create({
        data: { userId, type: "consume", channel: "credits", amount: -CREDIT_COST_PER_IMAGE },
      });
      return { billingType: "credits", creditCost: CREDIT_COST_PER_IMAGE, txId: tx2.id };
    });
  },

  /**
   * 按流水 ID 退款（孤儿消费冲销：计费成功但 TryOn 创建失败时调用，幂等）
   */
  async refundByTransaction(txId) {
    if (!txId) return;
    const consume = await prisma.creditTransaction.findUnique({ where: { id: txId } });
    if (!consume || consume.type !== "consume") return;

    // 幂等：同源流水已有 refund 则跳过
    const already = await prisma.creditTransaction.findFirst({
      where: { userId: consume.userId, type: "refund", channel: consume.channel, amount: -consume.amount, tryOnId: consume.tryOnId, reason: "orphan_consume" },
    });
    if (already) return;

    await prisma.$transaction(async (tx) => {
      if (consume.channel === "credits") {
        await tx.user.update({
          where: { id: consume.userId },
          data: { credits: { increment: -consume.amount } },
        });
      }
      await tx.creditTransaction.create({
        data: {
          userId: consume.userId,
          type: "refund",
          channel: consume.channel,
          amount: -consume.amount,
          tryOnId: consume.tryOnId,
          reason: "orphan_consume",
        },
      });
    });
  },

  /**
   * 补关联流水与生成记录（tryOn 建好后调用）
   */
  async linkTransaction(userId, tryOnId) {
    // 找该用户最近一条未关联 tryOnId 的 consume 流水（并发窗口内属于自己的）
    const latest = await prisma.creditTransaction.findFirst({
      where: { userId, type: "consume", tryOnId: null },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      await prisma.creditTransaction.update({
        where: { id: latest.id },
        data: { tryOnId },
      });
    }
  },

  /**
   * 退款（生成失败时冲销）：
   * - credits 计费 → 退回积分 + 写 refund 流水
   * - subscription 计费 → 写 refund 流水抵消额度占用（getMonthUsage 聚合时自动抵消）
   */
  async refundGeneration(userId, tryOnId) {
    const consume = await prisma.creditTransaction.findFirst({
      where: { tryOnId, type: "consume" },
      orderBy: { createdAt: "desc" },
    });
    if (!consume) return; // 无对应流水（如 custom_key），无需退款

    // 已退过款则跳过（幂等）
    const alreadyRefunded = await prisma.creditTransaction.findFirst({
      where: { tryOnId, type: "refund" },
    });
    if (alreadyRefunded) return;

    if (consume.channel === "credits") {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { credits: { increment: Math.abs(consume.amount) } },
        }),
        prisma.creditTransaction.create({
          data: {
            userId,
            type: "refund",
            channel: "credits",
            amount: Math.abs(consume.amount),
            tryOnId,
            reason: "generation_failed",
          },
        }),
      ]);
    } else if (consume.channel === "subscription") {
      // 额度冲销：+1 流水抵消消费的 -1
      await prisma.creditTransaction.create({
        data: {
          userId,
          type: "refund",
          channel: "subscription",
          amount: 1,
          tryOnId,
          reason: "generation_failed",
        },
      });
    }
  },

  /** 用户流水（对账/审计） */
  async getTransactions(userId, { page = 1, limit = 20 } = {}) {
    const [items, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.creditTransaction.count({ where: { userId } }),
    ]);
    return { items, total, page, limit };
  },

  /** 用量摘要（pricing 页/个人中心用） */
  async getUsageSummary(userId) {
    const [plan, monthUsage, credits] = await Promise.all([
      this.getActivePlan(userId),
      this.getMonthUsage(userId),
      this.getCredits(userId),
    ]);
    return {
      plan: plan.id,
      planName: plan.name,
      monthlyQuota: plan.monthlyQuota,
      monthUsage,
      remaining: Math.max(0, plan.monthlyQuota - monthUsage),
      credits,
    };
  },
};
