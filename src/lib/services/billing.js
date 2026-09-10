import { getStripe } from "../stripe";
import { getSiteConfigs, getSiteConfig } from "../site-config";
import config from "../config";
import { prisma } from "../prisma.js";
import { UserService } from "./user.js";

/**
 * 订阅计费服务（Stripe Checkout）
 * - createCheckoutSession：积分包一次性购买（USD）
 * - createSubscriptionCheckout：订阅月付（USD，统一货币）
 * - handleWebhook：Stripe 回调（订阅激活、积分发放）
 */
export const BillingService = {
  /** 积分包一次性购买（USD） */
  async createCheckoutSession(userId, planId) {
    const plan = config.stripe.plans[planId];
    if (!plan) throw new Error("Invalid plan selected");
    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: config.stripe.plans[planId].name,
              description: `Purchase ${plan.credits} credits to perform AI generations.`,
            },
            unit_amount: plan.price,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${config.auth.url}/pricing?success=true`,
      cancel_url: `${config.auth.url}/pricing?canceled=true`,
      metadata: { userId, credits: plan.credits.toString(), orderType: "credits", planId, amount: plan.price.toString() },
    });
    // 落 Order(pending) —— 对账依据（webhook paid 时更新状态）
    await prisma.order.create({
      data: {
        userId, type: "credits", planId,
        amount: plan.price, stripeSessionId: session.id,
        metadata: JSON.stringify({ name: config.stripe.plans[planId].name, credits: plan.credits }),
      },
    });
    return session.url;
  },

  /** 订阅套餐月付（统一货币 USD） */
  async createSubscriptionCheckout(userId, planId) {
    const subPlanId = planId.replace("sub_", "");
    const plan = SUBSCRIPTION_PLANS_FALLBACK[subPlanId];
    if (!plan || plan.priceUsd <= 0) throw new Error("Invalid subscription plan");
    const stripe = await getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `ModelShot ${plan.name}`,
              description: `Monthly ${plan.monthlyQuota} model shots, overage billed by credits.`,
            },
            unit_amount: plan.priceUsd * 100,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${config.auth.url}/pricing?success=true`,
      cancel_url: `${config.auth.url}/pricing?canceled=true`,
      metadata: { userId, subscriptionPlan: subPlanId, orderType: "subscription", planId: subPlanId, amount: plan.priceUsd.toString() },
    });
    // 落 Order(pending)
    await prisma.order.create({
      data: {
        userId, type: "subscription", planId: subPlanId,
        amount: plan.priceUsd, stripeSessionId: session.id,
        metadata: JSON.stringify({ name: plan.name, monthlyQuota: plan.monthlyQuota }),
      },
    });
    return session.url;
  },

  /**
   * Stripe Webhook 入口：处理订阅激活/积分包支付成功事件
   */
  async handleWebhook(body, signature) {
    const stripe = await getStripe();
    const event = await stripe.webhooks.constructEvent(body, signature, (await getSiteConfig("stripe_webhook_secret")) || config.stripe.webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (!userId) return;

      // 积分包：发放积分
      if (session.metadata.credits) {
        const credits = parseInt(session.metadata.credits, 10);
        await UserService.addCredits(userId, credits, { type: "purchase", reason: `Stripe checkout ${session.id}` });
      }

      // 订阅：激活套餐（30 天）
      if (session.metadata.subscriptionPlan) {
        const plan = session.metadata.subscriptionPlan;
        await prisma.user.update({
          where: { id: userId },
          data: {
            plan,
            planExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          },
        });
      }

      // 订单状态：pending → paid（对账闭环）
      if (session.id) {
        await prisma.order.updateMany({
          where: { stripeSessionId: session.id, status: "pending" },
          data: { status: "paid", paidAt: new Date() },
        });
      }

      // ── 分销佣金（P2 已实现）：被邀请人有邀请人则记 pending（orderId unique 防重放）──
      if (session.metadata.orderType) {
        const { recordCommission } = await import("../invite-service.js");
        await recordCommission(userId, session.id, parseFloat(session.metadata.amount) || 0);
      }
    }

    // 退款事件：订单 refunded + 佣金作废（P2 钩子位）
    if (event.type === "charge.refunded") {
      const charge = event.data.object;
      // 关联订单（session id 不在 charge 上，需要通过 payment_intent 反查——P1 接入时补全）
      // Order → refunded; InviteCommission(pending, orderId) → cancelled
    }

    // 取消订阅：回落 free 套餐
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      if (!userId) return;
      await prisma.user.update({
        where: { id: userId },
        data: { plan: "free", planExpiresAt: null },
      });
    }

    return { received: true };
  },
};

// 订阅套餐本地副本（避免循环引用，user.js 是真相源；价格保持 USD 统一货币）
const SUBSCRIPTION_PLANS_FALLBACK = {
  free: { id: "free", name: "Free", monthlyQuota: 10, priceUsd: 0 },
  standard: { id: "standard", name: "Standard", monthlyQuota: 300, priceUsd: 29 },
  pro: { id: "pro", name: "Pro", monthlyQuota: 1500, priceUsd: 99 },
};