"use client";

import { useState } from "react";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import { LoaderCircle, RefreshCw, X } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";

const statusCls = {
  pending: "text-warning bg-warning/10 border-warning/30",
  settled: "text-success bg-success/10 border-success/30",
  cancelled: "text-secondary-text bg-bg-page border-divider",
};

/**
 * 分销佣金管理（方案 4.8.5）— 流量手列表 / 改比例备注 / 结算 / 结算历史
 */
export default function AdminCommissions() {
  const reasonPrompt = useAdminReason();
  const { data: agents, loading, error, reload: load } = useRemoteResource("/api/admin/commissions");
  const [acting, setActing] = useState(null);
  const [detail, setDetail] = useState(null); // { agentId, ...commissions/logs }


  const openDetail = async (agentId) => {
    const res = await fetch(`/api/admin/commissions?agentId=${agentId}`);
    if (res.ok) setDetail({ agentId, ...(await res.json()) });
  };

  const settle = async (agent) => {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setActing(agent.id);
    try {
      const res = await fetch("/api/admin/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key },
        body: JSON.stringify({ agentId: agent.id, remark: approval.reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`已结算 $${data.amount}（${data.count} 笔）`);
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setActing(null);
    }
  };

  const patch = async (agentId, body, note) => {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setActing(agentId);
    try {
      const res = await fetch("/api/admin/commissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key },
        body: JSON.stringify({ agentId, ...body, reason: approval.reason }),
      });
      if (!res.ok) throw new Error();
      toast.success(note);
      await load();
    } catch {
      toast.error("Save failed");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="space-y-5">
      {reasonPrompt.dialog}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-medium text-primary-text">分销佣金</h1>
          <p className="text-xs text-secondary-text mt-1">比例：个人覆盖 → 全局默认（10%）；结算 = 全部 pending 核销 + 日志快照（线下打款）</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-secondary-text hover:text-primary-text cursor-pointer">
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {error ? <p role="alert" className="text-sm text-danger">加载失败，请刷新重试。</p> : loading ? (
        <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} /> Loading…</div>
      ) : !agents || agents.agents.length === 0 ? (
        <p className="text-sm text-secondary-text py-10 text-center">暂无流量手（用户管理页可升为 agent，或用户带邀请码注册后自动出现）</p>
      ) : (
        <div className="space-y-3">
          {agents.agents.map(a => (
            <div key={a.id} className="rounded-[16px] border border-divider bg-bg-card surface-lit p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium text-primary-text">{a.name || a.email}</div>
                  <div className="text-xs text-secondary-text/70">{a.email} · {a.role}</div>
                  {a.agentNote && <div className="text-xs text-secondary-text mt-1">备注：{a.agentNote}</div>}
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-secondary-text">邀请 <b className="text-primary-text tabular-nums">{a.inviteeCount}</b></span>
                  <span className="text-warning font-medium tabular-nums">待结算 ${a.pendingCommission}</span>
                  <span className="text-success font-medium tabular-nums">已结算 ${a.settledCommission}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-secondary-text">
                  个人比例
                  <input
                    type="number" step="0.01" min="0" max="1"
                    defaultValue={a.agentCommissionRate ?? ""}
                    placeholder="默认 10%"
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v && parseFloat(v) !== a.agentCommissionRate) patch(a.id, { agentCommissionRate: v }, "比例已更新");
                    }}
                    className="w-20 bg-bg-page border border-divider rounded px-2 py-1 text-xs tabular-nums"
                  />
                </label>
                <input
                  type="text"
                  defaultValue={a.agentNote || ""}
                  placeholder="渠道备注（如：闲鱼-学员A）"
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v !== (a.agentNote || "")) patch(a.id, { agentNote: v }, "备注已更新");
                  }}
                  className="flex-1 min-w-[180px] bg-bg-page border border-divider rounded px-2.5 py-1.5 text-xs"
                />
                <button
                  onClick={() => settle(a)}
                  disabled={acting === a.id || a.pendingCommission <= 0}
                  className="h-8 px-4 rounded-[10px] bg-primary hover:bg-primary-hover text-primary-btn-text text-xs font-medium cursor-pointer btn-sheen disabled:opacity-40"
                >结算</button>
                <button
                  onClick={() => openDetail(a.id)}
                  className="h-8 px-4 rounded-[10px] border border-divider hover:bg-bg-card text-primary-text text-xs font-medium cursor-pointer"
                >明细</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 明细抽屉 */}
      {detail && (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-bg-page/70 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-bg-card border-l border-divider shadow-2xl flex flex-col animate-enter">
            <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
              <span className="text-sm font-medium text-primary-text">佣金明细</span>
              <button onClick={() => setDetail(null)} className="p-2 rounded hover:bg-bg-card-hover text-secondary-text cursor-pointer"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <p className="text-xs text-secondary-text mb-2">佣金记录</p>
                {detail.commissions.length === 0 ? (
                  <p className="text-xs text-secondary-text">暂无</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-secondary-text"><th className="text-left py-1.5">订单</th><th className="text-right py-1.5">佣金</th><th className="text-left py-1.5 pl-3">状态</th></tr></thead>
                    <tbody>
                      {detail.commissions.map(c => (
                        <tr key={c.id} className="border-t border-divider/50">
                          <td className="py-2 text-primary-text tabular-nums">${c.orderAmount}</td>
                          <td className="py-2 text-right text-primary font-medium tabular-nums">${c.commissionAmount}</td>
                          <td className="py-2 pl-3"><span className={`px-2 py-0.5 rounded-full border font-medium ${statusCls[c.status]}`}>{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <p className="text-xs text-secondary-text mb-2">结算历史</p>
                {detail.logs.length === 0 ? (
                  <p className="text-xs text-secondary-text">暂无</p>
                ) : detail.logs.map(l => (
                  <div key={l.id} className="border border-divider rounded-[10px] p-3 mb-2 text-xs">
                    <div className="flex justify-between"><span className="text-primary-text font-medium">${l.amount}</span><span className="text-secondary-text">{new Date(l.createdAt).toLocaleString()}</span></div>
                    <div className="text-secondary-text mt-0.5">{l.settledRecordCount} 笔{l.remark ? ` · ${l.remark}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
