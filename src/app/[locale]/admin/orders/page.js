"use client";

import { useState, useEffect } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

const STATUSES = ["", "pending", "paid", "failed", "refunded"];
const TYPES = ["", "subscription", "credits"];

/**
 * 订单管理 — 筛选（状态/类型）+ 汇总（总收入/本月/退款）+ 漏单提示（pending>24h）
 */
export default function AdminOrders() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      const res = await fetch(`/api/admin/orders?${params}`);
      if (res.ok) setData(await res.json());
    } catch {
      toast.error("Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [status, type, page]);

  const statusCls = {
    paid: "text-success bg-success/10 border-success/30",
    pending: "text-warning bg-warning/10 border-warning/30",
    failed: "text-danger bg-danger/10 border-danger/30",
    refunded: "text-secondary-text bg-bg-page border-divider",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-medium text-primary-text">订单管理</h1>
          <p className="text-xs text-secondary-text mt-1">Stripe 支付记录（checkout 创建即落库，webhook 更新状态）</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-secondary-text hover:text-primary-text cursor-pointer">
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {/* 汇总卡 */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="总收入（paid）" value={`$${data.summary.totalRevenue.toFixed(2)}`} />
          <SummaryCard label="本月收入" value={`$${data.summary.monthRevenue.toFixed(2)}`} accent />
          <SummaryCard label="退款合计" value={`$${data.summary.totalRefunded.toFixed(2)}`} />
          <SummaryCard
            label="漏单（pending>24h）"
            value={String(data.summary.stalePending)}
            warn={data.summary.stalePending > 0}
          />
        </div>
      )}

      {/* 筛选 */}
      <div className="flex gap-2 flex-wrap">
        <Select value={status} onChange={v => { setStatus(v); setPage(1); }} options={STATUSES} labelAll="全部状态" />
        <Select value={type} onChange={v => { setType(v); setPage(1); }} options={TYPES} labelAll="全部类型" />
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} /> Loading…</div>
      ) : !data || data.orders.length === 0 ? (
        <p className="text-sm text-secondary-text py-10 text-center">暂无订单</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[12px] border border-divider">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-card/60 text-secondary-text">
                  <th className="text-left px-4 py-2.5 font-medium">订单</th>
                  <th className="text-left px-4 py-2.5 font-medium">用户</th>
                  <th className="text-left px-4 py-2.5 font-medium">类型/套餐</th>
                  <th className="text-right px-4 py-2.5 font-medium">金额</th>
                  <th className="text-left px-4 py-2.5 font-medium">状态</th>
                  <th className="text-left px-4 py-2.5 font-medium">支付时间</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map(o => (
                  <tr key={o.id} className="border-t border-divider/60 hover:bg-bg-card/40">
                    <td className="px-4 py-2.5 text-secondary-text tabular-nums">{o.id.slice(-8)}</td>
                    <td className="px-4 py-2.5 text-primary-text">{o.User?.email || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-secondary-text">{o.type === "subscription" ? "订阅" : "积分包"}</span>
                      <span className="text-secondary-text/70 ml-1">{o.planId}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-primary-text tabular-nums">${o.amount.toFixed(2)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${statusCls[o.status] || ""}`}>{o.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-secondary-text">{o.paidAt ? new Date(o.paidAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between text-xs text-secondary-text">
            <span>共 {data.total} 条 · 第 {data.page} 页</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded border border-divider hover:bg-bg-card disabled:opacity-40 cursor-pointer">上一页</button>
              <button onClick={() => setPage(p => (p * data.pageSize < data.total ? p + 1 : p))} disabled={page * data.pageSize >= data.total} className="px-3 py-1.5 rounded border border-divider hover:bg-bg-card disabled:opacity-40 cursor-pointer">下一页</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent, warn }) {
  return (
    <div className={`rounded-[12px] border p-4 ${warn ? "border-danger/40 bg-danger/5" : accent ? "border-primary/40 bg-primary-muted/20" : "border-divider bg-bg-card"}`}>
      <div className="text-xs text-secondary-text">{label}</div>
      <div className={`text-lg font-medium mt-1 tabular-nums ${warn ? "text-danger" : "text-primary-text"}`}>{value}</div>
    </div>
  );
}

function Select({ value, onChange, options, labelAll }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-bg-card border border-divider rounded-full px-3 py-1.5 text-xs text-primary-text cursor-pointer"
    >
      {options.map(o => <option key={o} value={o}>{o || labelAll}</option>)}
    </select>
  );
}
