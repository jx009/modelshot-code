"use client";

import { useSession } from "next-auth/react";
import { Check, Coins, Crown, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import ContentShell from "@/components/ContentShell";
import axios from "axios";
import toast, { Toaster } from "react-hot-toast";

// 套餐结构骨架 — 文案在渲染处按 key 从 messages 取
const SUBSCRIPTIONS = [
  { id: "sub_free", planId: "free", nameKey: "free", currency: "$", price: 0, period: "forever", quotaKey: "freeQuota", featuresKey: "freeFeatures" },
  { id: "sub_standard", planId: "standard", nameKey: "standard", currency: "$", price: 29, period: "perMonth", quotaKey: "standardQuota", featuresKey: "standardFeatures", ctaKey: "standardCta", popular: true },
  { id: "sub_pro", planId: "pro", nameKey: "pro", currency: "$", price: 99, period: "perMonth", quotaKey: "proQuota", featuresKey: "proFeatures", ctaKey: "proCta" },
];

const CREDIT_PACKS = [
  { id: "basic", nameKey: "packStarter", currency: "$", price: 5, credits: 100, descKey: "packStarterDesc" },
  { id: "standard", nameKey: "packStandard", currency: "$", price: 10, credits: 250, descKey: "packStandardDesc" },
  { id: "pro", nameKey: "packPro", currency: "$", price: 20, credits: 600, descKey: "packProDesc", popular: true },
  { id: "business", nameKey: "packBusiness", currency: "$", price: 50, credits: 2000, descKey: "packBusinessDesc" },
];

export default function Pricing() {
  const { data: session, status } = useSession();
  const t = useTranslations("pricing");
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/usage")
        .then(r => (r.ok ? r.json() : null))
        .then(setUsage)
        .catch(console.error);
    }
  }, [status]);

  const handleCheckout = async (planId) => {
    if (planId === "sub_free") {
      toast(t("freeNoNeed"), { icon: "ℹ️" });
      return;
    }
    if (status !== "authenticated") {
      toast.error(t("signInToBuy"));
      return;
    }

    setLoadingPlan(planId);
    try {
      const { data } = await axios.post("/api/checkout", { planId });
      if (data.url) {
        window.location.assign(data.url);
      } else {
        throw new Error("No redirection URL returned");
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || t("checkoutFail"));
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <ContentShell className="select-none">
      <Toaster position="top-right" />

      <main className="flex-1 w-full mx-auto max-w-content px-6 py-12 flex flex-col gap-12 items-center">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full mb-1">
            <Info className="text-primary text-xs"  />
            <span className="text-xs font-medium text-primary">{t("badge")}</span>
          </div>
          <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">{t("title")}</h1>
          <p className="text-xs sm:text-sm text-secondary-text max-w-prose leading-relaxed">
            {t("subtitle")}
          </p>
          {usage && (
            <div className="inline-flex items-center gap-3 text-xs font-medium bg-bg-card border border-divider rounded-full px-4 py-2">
              <Crown className="text-primary text-xs"  />
              <span>{t("current", {plan: usage.planName})}</span>
              <span className="text-secondary-text">|</span>
              <span>{t("usage", {used: usage.monthUsage, quota: usage.monthlyQuota})}</span>
              <span className="text-secondary-text">|</span>
              <span className="flex items-center gap-1"><Coins className="text-warning text-xs"  />{t("creditBalance", {credits: usage.credits})}</span>
            </div>
          )}
        </div>

        {/* 订阅套餐 */}
        <section className="w-full max-w-content space-y-5">
          <h2 className="text-sm font-medium text-secondary-text text-center">{t("subsTitle")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SUBSCRIPTIONS.map((sub) => {
              const periodLabel = sub.period === "forever" ? t("forever") : t("perMonth");
              return (
                <div
                  key={sub.id}
                  className={`relative bg-bg-card border rounded-[16px] flex flex-col transition-all duration-300 hover:-translate-y-0.5 ${
                    sub.popular
                      ? "border-primary/50 bg-primary-muted/30 recommend-glow"
                      : "border-divider surface-lit"
                  } ${sub.popular ? "pt-7" : "pt-6"} pb-6 px-6 gap-5`}
                >
                  {sub.popular && (
                    <span className="absolute top-0 inset-x-0 bg-primary text-primary-btn-text text-xs font-medium uppercase tracking-[0.14em] py-1.5 text-center rounded-t-[16px]">
                      {t("mostPopular")}
                    </span>
                  )}

                  {/* 套餐名 */}
                  <h3 className="text-xs uppercase tracking-[0.14em] text-secondary-text">{t(sub.nameKey)}</h3>

                  {/* 价格（货币符号上标 + 衬线数字 + 周期基线对齐） */}
                  <div className="flex items-baseline gap-1.5">
                    {sub.price > 0 && (
                      <span className="font-display text-[20px] text-secondary-text leading-none">{sub.currency}</span>
                    )}
                    <span className="font-display text-[40px] leading-none tracking-[-0.02em] text-primary-text tabular-nums">
                      {sub.price}
                    </span>
                    <span className="text-xs text-secondary-text font-sans leading-none ml-1">{periodLabel}</span>
                  </div>

                  {/* 额度（去容器化：大数字 + 小标签，不是禁用输入框） */}
                  <div className="py-3 border-y border-divider/50">
                    <div className="font-display text-[22px] leading-none text-primary-text tabular-nums">
                      {t(sub.quotaKey).split(' ')[0]}
                    </div>
                    <div className="text-xs text-secondary-text mt-1">
                      {t(sub.quotaKey).split(' ').slice(1).join(' ') || t("images")}
                    </div>
                  </div>

                  {/* 特性 */}
                  <ul className="space-y-2.5 text-xs text-secondary-text">
                    {t.raw(sub.featuresKey).map(f => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="text-primary mt-0.5 flex-shrink-0" size={13} strokeWidth={2.5} />
                        <span className="leading-snug">{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA：免费卡无按钮 = 文本说明 + 链接 */}
                  {sub.id === "sub_free" ? (
                    <p className="text-xs text-secondary-text text-center pt-2">
                      {t("freeIncludedByDefault")}
                    </p>
                  ) : (
                    <button
                      onClick={() => handleCheckout(sub.id)}
                      disabled={loadingPlan !== null}
                      className={`w-full min-h-[44px] py-3 rounded-[10px] text-sm font-medium transition-all cursor-pointer active:scale-[0.98] disabled:opacity-60 btn-sheen ${
                        sub.popular
                          ? "bg-primary text-primary-btn-text hover:bg-primary-hover"
                          : "bg-bg-page hover:bg-bg-card text-primary-text border border-divider"
                      }`}
                    >
                      {loadingPlan === sub.id ? t("creatingSession") : t(sub.ctaKey)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 积分包：紧凑横条（与订阅卡视觉区分——同张图两种卡型会令用户困惑）*/}
        <section className="w-full max-w-content space-y-5">
          <h2 className="text-sm font-medium text-secondary-text text-center">{t("packsTitle")}</h2>
          <div className="space-y-3">
            {CREDIT_PACKS.map((plan) => (
              <div
                key={plan.id}
                className={`flex items-center gap-4 px-5 py-4 rounded-[12px] border transition-colors ${
                  plan.popular
                    ? "bg-primary-muted/30 border-primary/40"
                    : "bg-bg-card border-divider hover:border-divider-strong"
                }`}
              >
                {plan.popular && (
                  <span className="text-xs font-medium uppercase tracking-[0.14em] text-primary whitespace-nowrap">
                    {t("recommended")}
                  </span>
                )}
                <h3 className="text-sm font-medium text-primary-text whitespace-nowrap">{t(plan.nameKey)}</h3>
                <p className="text-xs text-secondary-text flex-1 leading-snug">{t(plan.descKey)}</p>
                <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <span className="font-display text-[16px] text-secondary-text leading-none">{plan.currency}</span>
                  <span className="font-display text-[28px] leading-none tracking-[-0.02em] text-primary-text tabular-nums">{plan.price}</span>
                </div>
                <span className="text-xs text-secondary-text whitespace-nowrap tabular-nums">
                  {plan.credits} {t("credits")}
                </span>
                <button
                  onClick={() => handleCheckout(plan.id)}
                  disabled={loadingPlan !== null}
                  className="h-9 px-4 rounded-[10px] bg-bg-page hover:bg-bg-card-hover border border-divider text-xs font-medium text-primary-text transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50 min-w-[88px]"
                >
                  {loadingPlan === plan.id ? "..." : t("buyCredits")}
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-secondary-text text-center">{t("packNote")}</p>
        </section>
      </main>
    </ContentShell>
  );
}
