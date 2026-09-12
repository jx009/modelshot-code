"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, ExternalLink, CreditCard, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import { api, requestKey } from "@/lib/client-api";
import { formatMoney } from "@/lib/domain/billing/catalog";
import Modal from "@/components/ui/Modal";
import ExportTray from "@/components/gallery/ExportTray";
import AccountAssets from "@/components/AccountAssets";

export default function AccountPage() {
  const f = useTranslations("flow");
  const t = useTranslations("workspace");
  const locale = useLocale();
  const { data: session, status } = useSession();
  const [page, setPage] = useState(1);
  const account = useRemoteResource(status === "authenticated" ? `/api/account?page=${page}` : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [nextPlan, setNextPlan] = useState("sub_standard");
  const usage = account.data?.usage;
  const pendingSubscription = account.data?.subscriptionChanges?.some(row => row.state === "pending");
  useEffect(() => { if (!pendingSubscription) return; const timer = setInterval(account.reload, 4000); return () => clearInterval(timer); }, [pendingSubscription, account.reload]);
  function fail(err) { setError(f.has(`errors.${err.code}`) ? f(`errors.${err.code}`) : f("requestFailed")); }
  async function confirm() {
    setBusy(true); setError("");
    try {
      await api("/api/account/subscription", { method: "POST", key: confirmation.key, body: { subscriptionId: confirmation.id, action: confirmation.action, ...(confirmation.action === "change" ? { planId: nextPlan } : {}) } });
      account.reload();
      setConfirmation(null);
    } catch (err) { fail(err); } finally { setBusy(false); }
  }
  if (status === "unauthenticated") return <main className="account-page"><h1>{f("account")}</h1><Link href="/login" className="button primary">{t("signIn")}</Link></main>;
  return <main className="account-page"><header className="page-heading"><div><h1>{f("account")}</h1><p>{session?.user?.email}</p></div><button className="icon-button" aria-label={f("refresh")} title={f("refresh")} onClick={() => account.reload()}><RefreshCw size={18} /></button></header>
    {(error || account.error) && <p className="inline-error" role="alert">{error || f("loadError")}</p>}
    {account.loading && <p role="status">{t("loading")}</p>}
    {account.data?.subscriptionChanges?.filter(row => row.state !== "done").map(row => <p key={row.id} role="status">{f("subscription")}: {row.state === "pending" ? f("queued") : f("failed")}</p>)}
    {usage && <section className="account-section"><h2>{f("usage")}</h2><div className="usage-metrics">{[[f("available"), `${usage.remaining} ${f("quota")} + ${usage.credits} ${f("credits")}`], [f("reserved"), `${usage.reservedQuota} ${f("quota")} + ${usage.reservedCredits} ${f("credits")}`], [f("consumed"), `${usage.monthUsage} / ${usage.monthlyQuota}`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p>{f("cycle")}: {new Date(usage.cycleStartsAt).toLocaleDateString(locale)} - {new Date(usage.cycleEndsAt).toLocaleDateString(locale)} (UTC)</p><Link href="/pricing" className="button compact"><CreditCard size={16} />{f("choosePlan")}</Link></section>}
    <section className="account-section"><h2>{f("subscription")}</h2>{!account.data?.subscriptions.length && <p>{f("noData")}</p>}{account.data?.subscriptions.map(sub => <div className="subscription-row" key={sub.id}><div><strong>{sub.planId}</strong><p>{f.has(sub.status) ? f(sub.status) : sub.status} · {new Date(sub.periodEnd).toLocaleDateString(locale)}</p>{sub.scheduledPlanId && <p>{f("scheduledPlan", { plan: sub.scheduledPlanId })}</p>}</div>{["active", "trialing", "past_due"].includes(sub.status) && <div className="flex flex-wrap gap-2"><button className="button compact" onClick={() => setConfirmation({ type: "subscription", id: sub.id, action: sub.cancelAtPeriodEnd ? "resume" : "cancel", key: requestKey() })}>{f(sub.cancelAtPeriodEnd ? "resumeSubscription" : "cancelSubscription")}</button><button className="button compact" onClick={() => { setNextPlan(sub.planId === "sub_standard" ? "sub_pro" : "sub_standard"); setConfirmation({ type: "subscription", id: sub.id, action: "change", key: requestKey() }); }}>{f("changePlan")}</button></div>}</div>)}</section>
    <section className="account-section"><h2>{f("orders")}</h2><div className="table-scroll"><table className="workflow-table"><thead><tr>{["date", "name", "amount", "status", "receipt"].map(key => <th key={key}>{f(key)}</th>)}</tr></thead><tbody>{account.data?.orders.map(order => <tr key={order.id}><td>{new Date(order.createdAt).toLocaleDateString(locale)}</td><td>{order.planId}</td><td>{formatMoney(order.amountMinor, order.currency, locale)}{order.refundedMinor > 0 && <small>{f("refunded")}: {formatMoney(order.refundedMinor, order.currency, locale)}</small>}</td><td>{f.has(order.status) ? f(order.status) : order.status}{order.manualReview && <small>{f("manualReview")}</small>}</td><td>{order.receiptUrl && <a className="icon-button" href={order.receiptUrl} target="_blank" rel="noreferrer" title={f("receipt")} aria-label={f("receipt")}><ExternalLink size={16} /></a>}</td></tr>)}</tbody></table></div>{account.data?.orders.length === 0 && <p>{f("noData")}</p>}</section>
    <section className="account-section"><h2>{f("ledger")}</h2><div className="table-scroll"><table className="workflow-table"><thead><tr>{["date", "status", "amount", "reason"].map(key => <th key={key}>{f(key)}</th>)}</tr></thead><tbody>{account.data?.transactions.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString(locale)}</td><td>{row.type}</td><td>{row.amount > 0 ? "+" : ""}{row.amount} {row.channel === "subscription" ? f("quota") : f("credits")}</td><td>{row.tryOnId ? <Link href={`/gallery?id=${row.tryOnId}`}>{row.tryOnId.slice(-8)}</Link> : row.reason || "-"}</td></tr>)}</tbody></table></div></section>
    <div className="pagination"><button className="icon-button" aria-label={f("previous")} title={f("previous")} disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span>{f("page", { page })}</span><button className="icon-button" aria-label={f("next")} title={f("next")} disabled={(account.data?.orders.length || 0) < 20 && (account.data?.transactions.length || 0) < 30} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div>
    {status === "authenticated" && <><AccountAssets /><ExportTray /></>}
    {confirmation && <Modal label={f("subscription")} onClose={() => { if (!busy) setConfirmation(null); }}><h2>{f("subscription")}</h2><p>{f("confirmCancel")}</p>{confirmation.action === "change" && <select aria-label={f("changePlan")} value={nextPlan} onChange={e => setNextPlan(e.target.value)}><option value="sub_standard">Standard</option><option value="sub_pro">Pro</option></select>}<div className="dialog-actions"><button className="button" disabled={busy} onClick={() => setConfirmation(null)}>{f("cancel")}</button><button className="button primary" disabled={busy} onClick={confirm}>{f("save")}</button></div></Modal>}
  </main>;
}
