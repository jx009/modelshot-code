"use client";

import { useState, useEffect } from "react";
import { Copy, LoaderCircle, Users, X } from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import ContentShell from "@/components/ContentShell";
import { useTranslations } from "next-intl";

/**
 * 邀请中心（agent 及以上）— 方案 4.8.4
 * 邀请卡（码+链接）/ 业绩汇总 / 邀请明细 / 佣金明细
 */
export default function InvitePage() {
  const t = useTranslations("invite");
  const [data, setData] = useState(null);
  const [commissions, setCommissions] = useState(null);
  const [tab, setTab] = useState("invitees");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/invite").then(r => r.json()).catch(() => null),
    ]).then(([d]) => {
      if (d?.error) {
        setData({ forbidden: true });
      } else {
        setData(d);
      }
    }).finally(() => setLoading(false));
  }, []);

  const loadCommissions = async () => {
    const res = await fetch("/api/invite?tab=commissions");
    if (res.ok) setCommissions(await res.json());
  };

  const copy = (text, note) => {
    navigator.clipboard.writeText(text).then(() => toast.success(note));
  };

  if (loading) {
    return <ContentShell className="items-center justify-center"><LoaderCircle className="animate-spin text-primary" size={20} /></ContentShell>;
  }
  if (data?.forbidden) {
    return (
      <ContentShell className="items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-3">
          <Users size={28} className="text-secondary-text mx-auto" />
          <h1 className="font-display text-xl text-primary-text">{t("title")}</h1>
          <p className="text-sm text-secondary-text">{t("forbidden")}</p>
        </div>
      </ContentShell>
    );
  }

  const s = data?.summary || {};
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const inviteLink = `${origin}/en/login?ref=${data?.inviteCode || ""}`;

  return (
    <ContentShell className="px-6 py-10">
      <Toaster position="top-right" />
      <div className="max-w-content mx-auto w-full space-y-6">
        <div>
          <h1 className="font-display text-2xl tracking-[-0.02em] text-primary-text">{t("title")}</h1>
          <p className="text-sm text-secondary-text mt-1">{t("subtitle")}</p>
        </div>

        {/* 邀请卡 */}
        <div className="rounded-[16px] border border-primary/40 bg-primary-muted/20 p-6 flex flex-col sm:flex-row items-center gap-5">
          <div className="text-center">
            <div className="text-xs text-secondary-text mb-1">{t("code")}</div>
            <div className="font-display text-[32px] tracking-[0.2em] text-primary-text">{data?.inviteCode}</div>
          </div>
          <div className="flex-1 w-full space-y-2">
            <div className="text-xs text-secondary-text">{t("link")}</div>
            <div className="flex gap-2">
              <input readOnly value={inviteLink} className="flex-1 bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text" />
              <button onClick={() => copy(inviteLink, t("copied"))} className="h-9 px-3.5 rounded-[10px] bg-primary hover:bg-primary-hover text-primary-btn-text text-xs font-medium cursor-pointer btn-sheen inline-flex items-center gap-1.5">
                <Copy size={12} /> {t("copy")}
              </button>
            </div>
          </div>
        </div>

        {/* 业绩汇总 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={t("invitees")} value={s.inviteeCount ?? 0} />
          <Stat label={t("paidInvitees")} value={s.paidInviteeCount ?? 0} />
          <Stat label={t("orderTotal")} value={`$${s.totalOrderAmount ?? 0}`} />
          <Stat label={t("pending")} value={`$${s.pendingCommission ?? 0}`} accent />
          <Stat label={t("settled")} value={`$${s.settledCommission ?? 0}`} />
        </div>

        {/* 明细 Tabs */}
        <div className="flex gap-2">
          <TabBtn active={tab === "invitees"} onClick={() => setTab("invitees")}>{t("inviteeList")}</TabBtn>
          <TabBtn active={tab === "commissions"} onClick={() => { setTab("commissions"); loadCommissions(); }}>{t("commissionList")}</TabBtn>
        </div>

        {tab === "invitees" ? (
          <div className="rounded-[16px] border border-divider bg-bg-card surface-lit overflow-hidden">
            {(data?.invitees || []).length === 0 ? (
              <p className="text-sm text-secondary-text text-center py-10">{t("emptyInvitees")}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-bg-card/60 text-secondary-text">
                    <th className="text-left px-4 py-2.5 font-medium">{t("user")}</th>
                    <th className="text-left px-4 py-2.5 font-medium">{t("joinedAt")}</th>
                    <th className="text-center px-4 py-2.5 font-medium">{t("paid")}</th>
                    <th className="text-right px-4 py-2.5 font-medium">{t("contribution")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invitees.map(i => (
                    <tr key={i.id} className="border-t border-divider/60">
                      <td className="px-4 py-2.5 text-primary-text">{i.emailMasked || i.name}</td>
                      <td className="px-4 py-2.5 text-secondary-text">{i.invitedAt ? new Date(i.invitedAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-2.5 text-center">
                        {i.hasPaid ? <span className="text-success font-medium">{t("yes")}</span> : <span className="text-secondary-text">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-primary-text tabular-nums">${i.paidAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="rounded-[16px] border border-divider bg-bg-card surface-lit overflow-hidden">
            {!commissions || commissions.commissions.length === 0 ? (
              <p className="text-sm text-secondary-text text-center py-10">{t("emptyCommissions")}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-bg-card/60 text-secondary-text">
                    <th className="text-left px-4 py-2.5 font-medium">{t("orderAmount")}</th>
                    <th className="text-left px-4 py-2.5 font-medium">{t("rate")}</th>
                    <th className="text-left px-4 py-2.5 font-medium">{t("commission")}</th>
                    <th className="text-left px-4 py-2.5 font-medium">{t("status")}</th>
                    <th className="text-left px-4 py-2.5 font-medium">{t("time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.commissions.map(c => (
                    <tr key={c.id} className="border-t border-divider/60">
                      <td className="px-4 py-2.5 text-primary-text tabular-nums">${c.orderAmount}</td>
                      <td className="px-4 py-2.5 text-secondary-text tabular-nums">{(c.commissionRate * 100).toFixed(0)}%</td>
                      <td className="px-4 py-2.5 text-primary font-medium tabular-nums">${c.commissionAmount}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${
                          c.status === "settled" ? "text-success bg-success/10 border-success/30"
                          : c.status === "cancelled" ? "text-secondary-text bg-bg-page border-divider"
                          : "text-warning bg-warning/10 border-warning/30"
                        }`}>{t(c.status)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-secondary-text">{new Date(c.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </ContentShell>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`rounded-[12px] border p-4 ${accent ? "border-primary/40 bg-primary-muted/20" : "border-divider bg-bg-card"}`}>
      <div className="text-xs text-secondary-text">{label}</div>
      <div className="text-lg font-medium mt-1 text-primary-text tabular-nums">{value}</div>
    </div>
  );
}
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
      active ? "bg-primary-muted border-primary text-primary" : "bg-bg-card border-divider text-secondary-text hover:text-primary-text"
    }`}>{children}</button>
  );
}
