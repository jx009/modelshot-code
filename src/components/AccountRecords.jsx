"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, History, LoaderCircle, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { api } from "@/lib/client-api";
import { formatMoney } from "@/lib/domain/billing/catalog";
import { orderStatus, recordDetail, recordType } from "@/lib/billing-records";
import CreditIcon from "./ui/CreditIcon";
import Modal from "./ui/Modal";
import "./account-records.css";

function RecordDate({ value, locale }) {
  const date = new Date(value);
  return <time dateTime={value}><span>{date.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" })}</span><small>{date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}</small></time>;
}

export default function AccountRecords({ initialTab = "usage", onClose, onRecharge, onSignIn, returnFocusRef }) {
  const locale = useLocale(), zh = locale === "zh";
  const { data: session, status } = useSession();
  const [tab, setTab] = useState(initialTab), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null);
  const userId = session?.user?.id;
  const requestId = `${userId}:${tab}:${page}:${retry}`;
  useEffect(() => {
    if (!userId) return;
    const abort = new AbortController();
    api(`/api/account?tab=${tab}&page=${page}`, { signal: abort.signal })
      .then(data => { if (!abort.signal.aborted) setResult({ requestId, data }); })
      .catch(() => { if (!abort.signal.aborted) setResult({ requestId, error: true }); });
    return () => abort.abort();
  }, [userId, page, tab, requestId]);
  const current = result?.requestId === requestId ? result : null;
  const data = current?.data, loading = status === "loading" || Boolean(userId && !current);
  const rows = tab === "orders" ? data?.orders || [] : (data?.transactions || []).filter(row => row.amount !== 0);
  const hasMore = data?.pagination?.[tab]?.hasMore ?? rows.length >= (tab === "orders" ? 20 : 30);
  return <Modal label={zh ? "积分记录" : "Credit history"} className="ma-dialog" onClose={onClose} returnFocusRef={returnFocusRef}>
    <header><div><h2>{zh ? "积分记录" : "Credit history"}</h2></div><button className="ma-close" aria-label={zh ? "关闭积分记录" : "Close credit history"} onClick={onClose}><X size={20} /></button></header>
    <div className="ma-toolbar"><nav aria-label={zh ? "记录类型" : "Record type"}>{[["usage", "使用记录", "Usage history"], ["orders", "购买记录", "Purchases"]].map(([id, cn, en]) => <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setPage(1); }}>{zh ? cn : en}</button>)}</nav>{data?.usage && <span className="ma-balance"><CreditIcon size={17} /><span className="ma-balance-label">{zh ? "可用积分" : "Available"}</span><strong>{Number(data.usage.credits).toLocaleString(locale)}</strong></span>}</div>
    <div className="ma-scroll" aria-busy={loading}>
      {loading ? <div className="ma-empty" role="status"><LoaderCircle size={24} className="animate-spin" />{zh ? "正在加载记录…" : "Loading records…"}</div> : !userId ? <div className="ma-empty"><History size={28} /><p>{zh ? "登录后查看你的积分记录" : "Sign in to view your credit history"}</p><button onClick={() => onSignIn(tab)}>{zh ? "登录" : "Sign in"}</button></div> : current?.error ? <div className="ma-empty" role="alert"><p>{zh ? "记录加载失败，请重试。" : "Could not load records. Please try again."}</p><button onClick={() => setRetry(value => value + 1)}>{zh ? "重新加载" : "Retry"}</button></div> : <>
        <table className={tab === "orders" ? "ma-orders" : "ma-usage"}><thead><tr>{(tab === "orders" ? zh ? ["时间", "充值金额", "到账积分", "状态"] : ["Date", "Amount paid", "Credits received", "Status"] : zh ? ["时间", "类型", "积分变动", "说明"] : ["Date", "Activity", "Change", "Details"]).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><RecordDate value={row.createdAt} locale={locale} /></td>{tab === "orders" ? <><td className="ma-money">{formatMoney(row.amountMinor, row.currency, locale)}</td><td className="ma-credit">{["paid", "refunded"].includes(row.status) ? Number(row.creditedCredits || 0).toLocaleString(locale) : "—"}</td><td><span className="ma-status" data-status={row.status}>{orderStatus(row, locale)}</span></td></> : <><td className="ma-activity">{recordType(row, locale)}</td><td className="ma-change" data-positive={row.amount > 0}>{row.amount > 0 ? "+" : ""}{row.amount.toLocaleString(locale)}<small>{row.channel === "subscription" ? zh ? "额度" : "quota" : zh ? "积分" : "credits"}</small></td><td className="ma-detail">{recordDetail(row, locale)}</td></>}</tr>)}</tbody></table>
        {!rows.length && <div className="ma-empty"><History size={28} /><p>{tab === "orders" ? zh ? "还没有充值记录" : "No purchases yet" : zh ? "还没有积分变动" : "No credit activity yet"}</p></div>}
      </>}
    </div>
    <footer><div className="ma-pagination"><button aria-label={zh ? "上一页" : "Previous page"} disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><span>{zh ? `第 ${page} 页` : `Page ${page}`}</span><button aria-label={zh ? "下一页" : "Next page"} disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></div><button className="ma-recharge" onClick={onRecharge}>{zh ? "充值积分" : "Buy credits"}<ArrowUpRight size={15} /></button></footer>
  </Modal>;
}
