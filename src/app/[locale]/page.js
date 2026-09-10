import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import Badge from "@/components/ui/Badge";
import ContentShell from "@/components/ContentShell";
import Frame from "@/components/ui/Frame";
import BeforeAfter from "@/components/landing/BeforeAfter";

export async function generateMetadata({ params }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  return {
    title: t("heroTitle"),
    description: t("heroSubtitle"),
    alternates: {
      languages: Object.fromEntries(routing.locales.map(l => [l, `/${l}`])),
    },
    openGraph: {
      title: t("heroTitle"),
      description: t("heroSubtitle"),
      images: [`/og/${locale}.png`],
      locale,
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

/**
 * 落地页 — Editorial Studio 视觉
 * 展示字体标题 + 环境光晕 + 噪点 + 取景框母题 + 交错入场（纯 CSS，RSC 友好）
 */
export default async function LandingPage({ params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "landing" });
  const tp = await getTranslations({ locale, namespace: "pricing" });

  const faq = t.raw("faq");
  const compareRows = t.raw("compareRows");

  const steps = [
    { n: "01", title: t("step1Title"), desc: t("step1Desc") },
    { n: "02", title: t("step2Title"), desc: t("step2Desc") },
    { n: "03", title: t("step3Title"), desc: t("step3Desc") },
  ];

  const plans = [
    { name: tp("free"), price: "¥0", quota: tp("freeQuota") },
    { name: tp("standard"), price: "¥199", quota: tp("standardQuota"), popular: true },
    { name: tp("pro"), price: "¥599", quota: tp("proQuota") },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "ModelShot",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "CNY", description: "Free plan: 10 images per month" },
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map(item => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };

  return (
    <ContentShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ── Hero ── */}
      <section className="ambient-glow noise-layer">
        <div className="max-w-content mx-auto px-6 pt-24 pb-20 text-center relative">
          <Badge tone="primary" className="mb-8">{t("heroBadge")}</Badge>
          <h1 className="font-display text-[40px] sm:text-[56px] leading-[1.05] tracking-[-0.03em] max-w-prose mx-auto animate-enter">
            {t("heroTitle")}
          </h1>
          <p className="text-sm text-secondary-text max-w-prose mx-auto mt-6 leading-relaxed">
            {t("heroSubtitle")}
          </p>
          <div className="flex items-center justify-center gap-3 mt-10 flex-wrap">
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 bg-primary text-primary-btn-text rounded-[10px] px-8 py-3.5 min-h-[48px] text-sm font-medium hover:bg-primary-hover transition-all duration-[120ms] cursor-pointer btn-sheen active:scale-[0.99]"
            >
              {t("heroCta")}
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 bg-bg-card border border-divider rounded-[10px] px-8 py-3.5 min-h-[48px] text-sm font-medium text-primary-text hover:bg-bg-card-hover hover:border-divider-strong transition-all duration-[120ms] cursor-pointer"
            >
              {t("heroCtaSecondary")}
            </Link>
          </div>
          <p className="text-xs text-secondary-text/70 mt-4">{t("heroNote")}</p>

          {/* 效果对比：前后滑块 */}
          <div className="mt-16 max-w-prose mx-auto animate-enter" style={{ animationDelay: "150ms" }}>
            <BeforeAfter
              beforeSrc="/presets/scenes/scene-placeholder-01.png"
              afterSrc="/presets/models/model-sample-01.png"
              beforeLabel="flat-lay"
              afterLabel={t("demoLabel")}
            />
            <p className="text-xs text-secondary-text/70 mt-5">{t("demoPlaceholder")}</p>
          </div>
        </div>
      </section>

      {/* ── 三步流程 ── */}
      <section className="max-w-content mx-auto px-6 py-20 border-t border-divider/50">
        <h2 className="font-display text-2xl text-center tracking-[-0.01em]">{t("stepsTitle")}</h2>
        <div className="grid sm:grid-cols-3 gap-10 mt-12">
          {steps.map((s, i) => (
            <div key={s.n} className="relative text-center animate-stagger" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="font-display text-[64px] leading-none text-primary/15 absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none" aria-hidden>
                {s.n}
              </div>
              <div className="relative">
                <h3 className="text-base font-medium">{s.title}</h3>
                <p className="text-xs text-secondary-text mt-2.5 leading-relaxed max-w-[240px] mx-auto">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 价值对比 ── */}
      <section className="max-w-prose mx-auto px-6 py-20 border-t border-divider/50">
        <h2 className="font-display text-2xl text-center tracking-[-0.01em]">{t("compareTitle")}</h2>
        <div className="bg-bg-card border border-divider rounded-[16px] surface-lit overflow-hidden mt-10">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider text-secondary-text">
                <th className="text-left px-6 py-3.5 font-medium w-1/3"></th>
                <th className="text-left px-6 py-3.5 font-medium">{locale === "zh" ? "传统拍摄" : "Traditional photoshoot"}</th>
                <th className="text-left px-6 py-3.5 font-medium text-primary border-l-2 border-primary bg-primary/5">ModelShot</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row, i) => (
                <tr key={i} className="border-b border-divider/40 last:border-0">
                  <td className="px-6 py-3.5 text-secondary-text">{row[0]}</td>
                  <td className="px-6 py-3.5">{row[1]}</td>
                  <td className="px-6 py-3.5 text-primary border-l-2 border-primary/60 bg-primary/5 font-medium">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 平台适配 ── */}
      <section className="max-w-content mx-auto px-6 py-20 border-t border-divider/50 text-center">
        <h2 className="font-display text-2xl tracking-[-0.01em]">{t("platformsTitle")}</h2>
        <p className="text-xs text-secondary-text mt-3">{t("platformsDesc")}</p>
        <div className="flex items-center justify-center gap-4 mt-10 flex-wrap">
          {["Amazon", "TikTok Shop", locale === "zh" ? "淘宝/天猫" : "Taobao", "SHEIN"].map(name => (
            <div key={name} className="bg-bg-card border border-divider rounded-full px-6 py-2.5 text-sm text-secondary-text surface-lit">
              {name}
            </div>
          ))}
        </div>
      </section>

      {/* ── 合规（差异化卖点）── */}
      <section className="max-w-prose mx-auto px-6 py-20 border-t border-divider/50">
        <h2 className="font-display text-2xl text-center tracking-[-0.01em]">{t("complianceTitle")}</h2>
        <p className="text-sm text-secondary-text text-center mt-5 leading-relaxed">{t("complianceDesc")}</p>
        <div className="grid sm:grid-cols-3 gap-4 mt-10">
          {[t("compliancePoint1"), t("compliancePoint2"), t("compliancePoint3")].map((point, i) => (
            <Frame key={point} active={false} size={10} className="p-6 animate-stagger" style={{ animationDelay: `${i * 80}ms` }}>
              <p className="text-xs leading-relaxed text-primary-text">{point}</p>
            </Frame>
          ))}
        </div>
      </section>

      {/* ── 定价摘要 ── */}
      <section className="max-w-content mx-auto px-6 py-20 border-t border-divider/50">
        <h2 className="font-display text-2xl text-center tracking-[-0.01em]">{t("pricingTitle")}</h2>
        <p className="text-xs text-secondary-text text-center mt-3">{t("pricingSubtitle")}</p>
        <div className="grid sm:grid-cols-3 gap-4 mt-10">
          {plans.map(p => (
            <div
              key={p.name}
              className={`bg-bg-card border rounded-[16px] p-7 text-center surface-lit transition-all duration-[240ms] hover:border-divider-strong ${p.popular ? "border-primary/50 border-t-2 border-t-primary" : "border-divider"}`}
            >
              <div className="text-sm font-medium">{p.name}</div>
              <div className="font-display text-[36px] mt-3 tracking-[-0.02em]">{p.price}</div>
              <div className="text-xs text-secondary-text mt-1.5">{p.quota}</div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 bg-bg-card border border-divider rounded-[10px] px-6 py-3 min-h-[44px] text-xs font-medium hover:bg-bg-card-hover hover:border-divider-strong transition-all duration-[120ms] cursor-pointer"
          >
            {t("pricingCta")}
          </Link>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="max-w-prose mx-auto px-6 py-20 border-t border-divider/50">
        <h2 className="font-display text-2xl text-center tracking-[-0.01em]">{t("faqTitle")}</h2>
        <div className="mt-10 space-y-3">
          {faq.map((item, i) => (
            <details key={i} className="bg-bg-card border border-divider rounded-[16px] overflow-hidden group surface-lit">
              <summary className="px-6 py-4.5 text-sm font-medium cursor-pointer list-none flex items-center justify-between hover:bg-bg-card-hover/50 transition-colors">
                {item.q}
                <span className="text-secondary-text text-xs group-open:rotate-180 transition-transform duration-[240ms]">▾</span>
              </summary>
              <p className="px-6 pb-5 text-xs text-secondary-text leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── 终 CTA ── */}
      <section className="ambient-glow">
        <div className="max-w-prose mx-auto px-6 py-24 text-center relative">
          <h2 className="font-display text-[32px] leading-tight tracking-[-0.02em]">{t("finalCtaTitle")}</h2>
          <p className="text-sm text-secondary-text mt-4">{t("finalCtaSubtitle")}</p>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 bg-primary text-primary-btn-text rounded-[10px] px-10 py-4 min-h-[52px] text-sm font-medium hover:bg-primary-hover transition-all duration-[120ms] cursor-pointer mt-10 btn-sheen active:scale-[0.99]"
          >
            {t("finalCta")}
          </Link>
        </div>
      </section>
    </ContentShell>
  );
}
