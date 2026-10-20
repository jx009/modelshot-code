"use client";

import { useEffect, useState } from "react";
import { Copy, LoaderCircle, Users, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { api } from "@/lib/client-api";
import Modal from "./ui/Modal";
import "./invite-center.css";

export default function InviteCenter({ onClose, returnFocusRef }) {
  const locale = useLocale(), zh = locale === "zh", t = useTranslations("invite");
  const { data: session, status } = useSession();
  const [currency, setCurrency] = useState(zh ? "cny" : "usd");
  const [tab, setTab] = useState("invitees"), [retry, setRetry] = useState(0);
  const [overview, setOverview] = useState(null), [details, setDetails] = useState(null);
  const [copyState, setCopyState] = useState("");
  const userId = session?.user?.id;
  const requestId = `${userId}:${currency}:${retry}`;
  const commissionId = `${userId}:${retry}`;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    api(`/api/invite?currency=${currency}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setOverview({ requestId, data }); })
      .catch(error => { if (!controller.signal.aborted) setOverview({ requestId, error: error.status === 403 ? "forbidden" : "failed" }); });
    return () => controller.abort();
  }, [userId, currency, requestId]);
  useEffect(() => {
    if (!userId || tab !== "commissions") return;
    const controller = new AbortController();
    api("/api/invite?tab=commissions", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setDetails({ requestId: commissionId, data }); })
      .catch(() => { if (!controller.signal.aborted) setDetails({ requestId: commissionId, error: true }); });
    return () => controller.abort();
  }, [userId, tab, commissionId]);
  const current = overview?.requestId === requestId ? overview : null;
  const commission = details?.requestId === commissionId ? details : null;
  const loading = status === "loading" || Boolean(userId && !current);
  const data = current?.data, summary = data?.summary || {};
  const money = (value, unit = currency) => new Intl.NumberFormat(zh ? "zh-CN" : "en-US", { style: "currency", currency: unit.toUpperCase() }).format(value || 0);
  const date = value => value ? new Date(value).toLocaleDateString(zh ? "zh-CN" : "en-US") : "—";
  const link = data?.inviteCode ? `${window.location.origin}/${locale}/login?ref=${encodeURIComponent(data.inviteCode)}` : "";
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }
  const errorView = forbidden => <div className="ic-empty" role="alert"><Users size={26} /><p>{forbidden ? t("forbidden") : zh ? "邀请数据加载失败，请重试。" : "Unable to load invite data. Please retry."}</p>{!forbidden && <button onClick={() => setRetry(value => value + 1)}>{zh ? "重新加载" : "Retry"}</button>}</div>;
  return <Modal label={t("title")} className="ic-dialog" onClose={onClose} returnFocusRef={returnFocusRef}>
    <header className="ic-header"><div><h2>{t("title")}</h2><p>{t("subtitle")}</p></div><button className="ic-close" aria-label={zh ? "关闭邀请中心" : "Close invite center"} onClick={onClose}><X size={20} /></button></header>
    <div className="ic-scroll" aria-busy={loading}>
      {loading ? <div className="ic-empty" role="status"><LoaderCircle className="animate-spin" size={22} />{zh ? "正在加载…" : "Loading…"}</div>
        : !userId || current?.error === "forbidden" ? errorView(true)
          : current?.error || !data?.inviteCode ? errorView(false)
            : <>
              <section className="ic-code-card" aria-label={t("code")}><div><span>{t("code")}</span><strong>{data.inviteCode}</strong></div><label>{t("link")}<div className="ic-copy"><input aria-label={t("link")} readOnly value={link} onFocus={event => event.target.select()} /><button onClick={copy}><Copy size={15} />{copyState === "copied" ? t("copied") : t("copy")}</button></div></label></section>
              {copyState && <p className="ic-feedback" role="status">{copyState === "copied" ? t("copied") : zh ? "复制失败，请选中邀请链接手动复制。" : "Select the invite link and copy it manually."}</p>}
              <div className="ic-currency"><label>{zh ? "业绩币种" : "Currency"}<select value={currency} onChange={event => { setCurrency(event.target.value); setCopyState(""); }}><option value="cny">人民币 CNY</option><option value="usd">USD 美元</option></select></label></div>
              <div className="ic-stats">{[["invitees", summary.inviteeCount ?? 0], ["paidInvitees", summary.paidInviteeCount ?? 0], ["orderTotal", money(summary.totalOrderAmount)], ["pending", money(summary.pendingCommission)], ["settled", money(summary.settledCommission)]].map(([id, value]) => <div key={id} data-accent={id === "pending" || undefined}><span>{t(id)}</span><strong>{value}</strong></div>)}</div>
              <nav className="ic-tabs" aria-label={zh ? "邀请明细类型" : "Invite record type"}>{["invitees", "commissions"].map(id => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{t(id === "invitees" ? "inviteeList" : "commissionList")}</button>)}</nav>
              {tab === "invitees" ? <div className="ic-table-scroll">
                {!data.invitees?.length ? <p className="ic-empty">{t("emptyInvitees")}</p> : <table><thead><tr>{["user", "joinedAt", "paid", "contribution"].map(id => <th key={id}>{t(id)}</th>)}</tr></thead><tbody>{data.invitees.map(row => <tr key={row.id}><td>{row.emailMasked || row.name}</td><td>{date(row.invitedAt)}</td><td>{row.hasPaid ? t("yes") : "—"}</td><td>{money(row.paidAmount)}</td></tr>)}</tbody></table>}
              </div> : !commission ? <div className="ic-empty" role="status"><LoaderCircle className="animate-spin" size={20} />{zh ? "正在加载佣金…" : "Loading commissions…"}</div>
                : commission.error ? errorView(false) : <div className="ic-table-scroll">
                  {!commission.data?.commissions?.length ? <p className="ic-empty">{t("emptyCommissions")}</p> : <table><thead><tr>{["orderAmount", "rate", "commission", "status", "time"].map(id => <th key={id}>{t(id)}</th>)}</tr></thead><tbody>{commission.data.commissions.map(row => <tr key={row.id}><td>{money(row.orderAmount, row.currency)}</td><td>{(row.commissionRate * 100).toFixed(0)}%</td><td>{money(row.commissionAmount, row.currency)}</td><td><span className="ic-status" data-status={row.status}>{["pending", "settled", "cancelled"].includes(row.status) ? t(`${row.status}_status`) : "—"}</span></td><td>{date(row.createdAt)}</td></tr>)}</tbody></table>}
                </div>}
            </>}
    </div>
  </Modal>;
}
