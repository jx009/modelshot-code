"use client";
import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { CreditCard, LoaderCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import { api, requestKey } from "@/lib/client-api";
import { formatMoney } from "@/lib/domain/billing/catalog";

export default function Pricing() {
  const f = useTranslations("flow");
  const t = useTranslations("pricing");
  const locale = useLocale();
  const { status } = useSession();
  const catalog = useRemoteResource("/api/catalog");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const keys = useRef({});
  async function checkout(planId) {
    setBusy(planId); setError("");
    keys.current[planId] ||= requestKey();
    try {
      const result = await api("/api/checkout", { method: "POST", key: keys.current[planId], body: { planId } });
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new Error("CHECKOUT_URL_INVALID");
      window.location.assign(url.href);
    } catch (err) { setError(f.has(`errors.${err.code}`) ? f(`errors.${err.code}`) : f("requestFailed")); } finally { setBusy(""); }
  }
  return <main className="account-page pricing-page"><header className="page-heading"><h1>{t("title")}</h1><Link href="/account" className="button"><CreditCard size={17} />{f("account")}</Link></header>
    {(error || catalog.error) && <p className="inline-error" role="alert">{error || f("loadError")}</p>}{catalog.loading && <LoaderCircle className="animate-spin" />}
    {!catalog.loading && !catalog.data?.paymentsEnabled && <p className="service-notice">{f("paymentsUnavailable")}</p>}
    <section className="account-section"><h2>{t("subsTitle")}</h2><div className="plan-grid"><article className="plan-item"><h3>{t("free")}</h3><strong>{formatMoney(0, "usd", locale)}</strong><p>10 {t("images")} / UTC {t("perMonth")}</p><Link href="/studio" className="button">{f("back")}</Link></article>{catalog.data?.products.filter(plan => plan.type === "subscription").map(plan => <article className="plan-item" key={plan.id}><h3>{plan.name}</h3><strong>{formatMoney(plan.amountMinor, plan.currency, locale)}</strong><span>{t("perMonth")}</span><p>{plan.quota} {t("images")}</p>{status !== "authenticated" ? <Link className="button" href="/login">{t("signInToBuy")}</Link> : <button className="button primary" disabled={!!busy || !catalog.data.paymentsEnabled} onClick={() => checkout(plan.id)}>{busy === plan.id && <LoaderCircle size={16} className="animate-spin" />}{f("choosePlan")}</button>}</article>)}</div></section>
    <section className="account-section"><h2>{t("packsTitle")}</h2><div className="table-scroll"><table className="workflow-table"><thead><tr>{["name", "credits", "price"].map(key => <th key={key}>{f(key)}</th>)}<th /></tr></thead><tbody>{catalog.data?.products.filter(plan => plan.type === "credits").map(plan => <tr key={plan.id}><td>{plan.name}</td><td>{plan.credits}</td><td>{formatMoney(plan.amountMinor, plan.currency, locale)}</td><td><button className="button compact" disabled={!!busy || !catalog.data.paymentsEnabled || status !== "authenticated"} onClick={() => checkout(plan.id)}><CreditCard size={15} />{t("buyCredits")}</button></td></tr>)}</tbody></table></div><p>{f("deliveryPolicy")}</p><p>{f("byokPolicy")}</p></section>
  </main>;
}
