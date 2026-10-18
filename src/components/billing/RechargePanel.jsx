"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { ArrowUpRight, Check, CircleCheck, Coins, CreditCard, LoaderCircle, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import { requestKey } from "@/lib/client-api";
import styles from "./recharge.module.css";
import CreditIcon from "@/components/ui/CreditIcon";
const METHOD_NAMES = { alipay: ["支付宝", "Alipay"], wxpay: ["微信支付", "WeChat Pay"], qqpay: ["QQ 钱包", "QQ Pay"], stripe: ["银行卡 / Stripe", "Card / Stripe"] };
const ERRORS = { CHECKOUT_UNAVAILABLE: "暂未开放充值，请稍后再试。", PAYMENT_METHOD_UNAVAILABLE: "该支付方式暂不可用，请刷新。", PACKAGE_UNAVAILABLE: "套餐已下架，请重新选择。", PAYMENT_CONFIGURATION_CHANGED: "支付配置已更新，请重新下单。", PACKAGE_CHANGED: "套餐价格或积分已调整，请刷新后重新选择。", ORDER_ALREADY_PROCESSED: "该订单已处理，请查看到账状态或重新下单。", CHECKOUT_EXPIRED: "订单已过期，请重新下单。", UNAUTHORIZED: "请先登录后再充值。" };
function pendingOrder(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* Payment remains usable when browser storage is unavailable. */ }
  return null;
}
function price(row, zh) { return new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: row.currency.toUpperCase(), maximumFractionDigits: 2 }).format(row.amountMinor / 100); }
export default function RechargePanel({ onClose, onRecords }) {
  const auth = useAuth();
  const locale = useLocale(), zh = locale === "zh";
  const { data: session, status, update } = useSession();
  const [catalog, setCatalog] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState(""), [method, setMethod] = useState(""), [busy, setBusy] = useState(false);
  const [orderId, setOrderId] = useState(""), [payment, setPayment] = useState(null), [checking, setChecking] = useState(false), [pollRound, setPollRound] = useState(0);
  const keys = useRef(new Map()), lastPaid = useRef("");
  const storageKey = `letai:recharge:${session?.user?.id || "guest"}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/catalog?locale=${locale}`, { cache: "no-store", signal: controller.signal }).then(async res => {
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      setCatalog(body); setSelected(body.products.find(p => p.recommended)?.id || body.products[0]?.id || ""); setMethod(body.methods?.[0]?.id || "");
    }).catch(e => { if (e.name !== "AbortError") setError(zh ? "套餐加载失败，请稍后重试。" : "Could not load credit packs. Please try again."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [locale, zh]);
  useEffect(() => {
    if (!session?.user?.id) return;
    const id = new URLSearchParams(window.location.search).get("orderId") || pendingOrder(storageKey);
    // Synchronize the external payment-return URL and tab storage on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && /^[a-zA-Z0-9_-]{1,80}$/.test(id)) setOrderId(id);
  }, [session?.user?.id, storageKey]);
  useEffect(() => {
    if (!orderId || !session?.user?.id) return;
    let active = true, timer, attempts = 0;
    const controller = new AbortController();
    async function check() {
      setChecking(true);
      try {
        const res = await fetch(`/api/recharge/status?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store", signal: controller.signal });
        const body = await res.json(); if (!active) return;
        if (!res.ok) { if (res.status === 404) { pendingOrder(storageKey, null); setOrderId(""); return; } throw new Error(body.error); }
        setPayment(body);
        if (body.status === "paid") {
          pendingOrder(storageKey, null); keys.current.clear();
          if (lastPaid.current !== body.id) { lastPaid.current = body.id; await update(); }
          return;
        }
        if (body.status !== "pending") { pendingOrder(storageKey, null); return; }
      } catch (e) { if (e.name === "AbortError") return; }
      finally { if (active) setChecking(false); }
      if (active && ++attempts < 60) timer = setTimeout(check, 3000);
    }
    void check();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
    // Session update changes identity; do not restart completed polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, session?.user?.id, pollRound, storageKey]);
  const plan = catalog?.products.find(p => p.id === selected);
  const terminalPayment = payment && !["pending", "paid"].includes(payment.status);
  const terminalLabel = payment?.status === "refunded" ? (zh ? "该订单已退款。" : "This order has been refunded.") : (zh ? "该订单已结束，请重新选择套餐充值。" : "This order has ended. Please start a new purchase.");
  async function purchase() {
    if (!plan || !method || busy) return;
    if (!session?.user?.id) { auth.open(); return; }
    setBusy(true); setError("");
    const selection = `${selected}:${method}:${locale}`;
    if (!keys.current.has(selection)) keys.current.set(selection, requestKey());
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": keys.current.get(selection) }, body: JSON.stringify({ planId: selected, method, locale, expectedAmountMinor: plan.amountMinor, expectedCredits: plan.credits }) });
      const body = await res.json();
      if (!res.ok) { if ([400, 409].includes(res.status)) keys.current.delete(selection); throw new Error(body.error); }
      pendingOrder(storageKey, body.orderId); setOrderId(body.orderId); setPayment(null);
      const url = new URL(body.url);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("INVALID_PAYMENT_URL");
      if (body.provider === "epay") {
        const form = document.createElement("form"); form.method = "POST"; form.action = url.href;
        for (const [name, value] of Object.entries(body.params)) { const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input); }
        document.body.appendChild(form); form.submit(); form.remove();
      } else if (url.protocol === "https:" && url.hostname === "checkout.stripe.com") window.location.assign(url.href);
      else throw new Error("INVALID_PAYMENT_URL");
    } catch (e) { setError(zh ? ERRORS[e.message] || "发起支付失败，请重试。" : "Could not start payment. Please refresh and try again."); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel}>
    <header className={styles.header}><div className={styles.heading}><span className={styles.eyebrow}><Sparkles size={13} />{zh ? "为灵感续航" : "ROOM FOR YOUR NEXT IDEA"}</span><h1>{zh ? "积分充值" : "Credits for your next creation"}</h1><p>{zh ? "按需充值，积分永久有效。" : "Choose your amount. Credits never expire."}</p></div><div className={styles.headerActions}>{session?.user && <span className={styles.balance}><Coins size={15} /><span>{zh ? "当前积分" : "Balance"}<strong>{Number(session.user.credits || 0).toLocaleString()}</strong></span></span>}{onClose && <button className={styles.close} onClick={onClose} aria-label={zh ? "关闭充值" : "Close recharge"}><X size={20} /></button>}</div></header>
    <div className={styles.content}>
      {orderId && <div className={`${styles.notice} ${payment?.status === "paid" ? styles.success : ""}`} role="status">{payment?.status === "paid" ? <><CircleCheck size={19} /><span>{zh ? `充值成功，${payment.credits.toLocaleString()} 积分已到账。` : `Payment confirmed. ${payment.credits.toLocaleString()} credits added.`}</span></> : <><LoaderCircle size={17} className={checking ? "animate-spin" : ""} /><span>{terminalPayment ? terminalLabel : zh ? "正在等待支付平台确认，到账后余额会自动更新。" : "Waiting for payment confirmation. Your balance will update automatically."}</span>{!terminalPayment && <button onClick={() => setPollRound(r => r + 1)}>{zh ? "查询到账" : "Check status"}</button>}<button onClick={() => { pendingOrder(storageKey, null); setOrderId(""); setPayment(null); }}>{zh ? "收起" : "Dismiss"}</button></>}</div>}
      {loading ? <div className={styles.loading}><LoaderCircle className="animate-spin" size={22} />{zh ? "正在加载积分套餐…" : "Loading credit packs…"}</div> : <div className={styles.packs}>{catalog?.products.map(p => <button key={p.id} type="button" className={`${styles.pack} ${selected === p.id ? styles.selected : ""}`} onClick={() => setSelected(p.id)} aria-pressed={selected === p.id} aria-label={`${p.credits.toLocaleString()} ${zh ? "积分" : "credits"} · ${price(p, zh)}`}>
        <div className={styles.packTop}>{p.recommended && <span className={styles.recommended}>{zh ? "推荐" : "POPULAR"}</span>}<span className={styles.radio}>{selected === p.id && <Check size={12} />}</span></div>
        <h2 className={styles.price}>{price(p, zh)}</h2>
        <div className={styles.creditAmount}><CreditIcon size={18} /><strong>{p.credits.toLocaleString()}</strong><span>{zh ? "积分" : "credits"}</span></div>
        <span className={styles.feature}><Check size={13} />{zh ? "永久有效 · 随用随扣" : "Never expires · Pay as you create"}</span>
      </button>)}</div>}
      {!loading && !catalog?.products.length && !error && <p className={styles.muted}>{zh ? "暂无上架套餐。" : "No credit packs are available."}</p>}
      <div className={styles.paymentRow}><div><h3>{zh ? "支付方式" : "Payment method"}</h3><div className={styles.methods}>{catalog?.methods?.map(m => <button key={m.id} className={`${styles.method} ${method === m.id ? styles.methodActive : ""}`} onClick={() => setMethod(m.id)} aria-pressed={method === m.id}><span className={styles.methodSymbol} data-channel={m.id}>{m.id === "alipay" ? "支" : m.id === "wxpay" ? "微" : <CreditCard size={16} />}</span>{METHOD_NAMES[m.id]?.[zh ? 0 : 1]}{method === m.id && <Check size={13} />}</button>)}</div>{!loading && !catalog?.methods?.length && <p className={styles.muted}>{zh ? "充值暂未开放，请联系管理员。" : "Payments are not available yet. Please contact support."}</p>}</div><div className={styles.assurances}><span><ShieldCheck size={14} />{zh ? "安全支付" : "Secure payment"}</span><span><Zap size={14} />{zh ? "支付确认后自动到账" : "Credits added on confirmation"}</span></div></div>
      {error && <div className={styles.error} role="alert">{error}<button onClick={() => window.location.reload()}>{zh ? "刷新" : "Reload"}</button></div>}
    </div>
    <footer className={styles.footer}><div className={styles.total}>{zh ? "实付金额" : "Total"}<strong>{plan ? price(plan, zh) : "—"}</strong><span>{plan ? `${plan.credits.toLocaleString()} ${zh ? "积分，永久有效" : "credits, no expiry"}` : ""}</span></div><div className={styles.checkoutActions}><button type="button" className={styles.history} onClick={onRecords}>{zh ? "充值记录" : "Billing history"}</button><button className={styles.pay} disabled={busy || loading || !plan || !catalog?.paymentsEnabled || !method || status === "loading"} onClick={purchase}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <>{session?.user?.id ? zh ? "立即充值" : "Buy credits" : zh ? "登录并充值" : "Sign in to recharge"}<ArrowUpRight size={17} /></>}</button></div></footer>
  </section>;
}
