"use client";

import { useState, useEffect } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";

/**
 * 成本利润（方案 4.7）— 转售生图赚差价的定价决策依据
 * 月指标 / 30 天双线+毛利率 / 通道对比 / 成本环比预警
 */
export default function AdminCost() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/cost")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} /> Loading…</div>;
  }
  if (!data) return <p className="text-sm text-secondary-text py-10">加载失败</p>;

  const m = data.month;
  const maxVal = Math.max(...data.trend.map(t => Math.max(t.revenue, t.cost)), 0.01);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-base font-medium text-primary-text">成本利润</h1>
        <p className="text-xs text-secondary-text mt-1">
          收入 = paid 订单（Stripe）；成本 = TryOn.costUsd 按 provider 报价估算。毛利率是定价决策的唯一依据。
        </p>
      </div>

      {/* 异常预警 */}
      {data.costSurge && (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
          <TriangleAlert size={14} className="mt-0.5 flex-shrink-0" />
          <span>{data.costSurge.message}</span>
        </div>
      )}

      {/* 月指标 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="本月收入" value={`$${m.revenue.toFixed(2)}`} sub={`${m.paidOrders} 笔订单`} accent />
        <Metric label="本月成本" value={`$${m.cost.toFixed(2)}`} sub={`${m.generatedImages} 张生成`} />
        <Metric
          label="毛利率"
          value={m.margin === null ? "—" : `${m.margin}%`}
          sub={m.margin === null ? "本月无收入" : m.margin >= 50 ? "健康" : m.margin >= 0 ? "偏低" : "亏损"}
          warn={m.margin !== null && m.margin < 0}
        />
        <Metric label="单张口径" value={`成本 $${m.perImageCost}`} sub={`收入 $${m.perImageRevenue}/张`} />
      </div>

      {/* 30 天趋势 */}
      <div className="rounded-[16px] border border-divider bg-bg-card surface-lit p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-primary-text">30 天收入 / 成本</h2>
          <div className="flex gap-4 text-xs text-secondary-text">
            <Legend color="bg-primary" label="收入" />
            <Legend color="bg-danger/70" label="成本" />
          </div>
        </div>
        {/* 双向柱：收入向上（主色），成本向下（红） */}
        <div className="relative h-40">
          <div className="absolute inset-x-0 top-1/2 h-px bg-divider" />
          <div className="flex items-center h-full gap-1">
            {data.trend.map((t, i) => (
              <div key={i} className="flex-1 relative h-full" title={`${t.date} 收入$${t.revenue} 成本$${t.cost}${t.margin !== null ? ` 毛利率${t.margin}%` : ""}`}>
                <div className="absolute bottom-1/2 w-full">
                  <div className="mx-auto w-2/3 rounded-t bg-primary" style={{ height: `${(t.revenue / maxVal) * 48}%`, minHeight: t.revenue > 0 ? 2 : 0 }} />
                </div>
                <div className="absolute top-1/2 w-full">
                  <div className="mx-auto w-2/3 rounded-b bg-danger/70" style={{ height: `${(t.cost / maxVal) * 48}%`, minHeight: t.cost > 0 ? 2 : 0 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-secondary-text mt-2">
          <span>{data.trend[0]?.date}</span>
          <span>{data.trend[data.trend.length - 1]?.date}</span>
        </div>
      </div>

      {/* 通道对比 */}
      <div className="rounded-[16px] border border-divider bg-bg-card surface-lit p-5">
        <h2 className="text-sm font-medium text-primary-text mb-4">通道对比（30 天）</h2>
        {data.providers.length === 0 ? (
          <p className="text-xs text-secondary-text">暂无调用数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-secondary-text border-b border-divider">
                  <th className="text-left py-2 font-medium">通道</th>
                  <th className="text-right py-2 font-medium">调用量</th>
                  <th className="text-right py-2 font-medium">失败率</th>
                  <th className="text-right py-2 font-medium">成本</th>
                  <th className="text-right py-2 font-medium">成本占比</th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map(p => (
                  <tr key={p.provider} className="border-b border-divider/50 last:border-0">
                    <td className="py-2.5 text-primary-text">{p.provider}</td>
                    <td className="py-2.5 text-right text-primary-text tabular-nums">{p.count}</td>
                    <td className={`py-2.5 text-right tabular-nums ${p.failRate > 10 ? "text-danger" : "text-success"}`}>{p.failRate}%</td>
                    <td className="py-2.5 text-right text-primary-text tabular-nums">${p.cost.toFixed(2)}</td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-16 h-1.5 rounded-full bg-bg-page overflow-hidden">
                          <span className="block h-full bg-primary rounded-full" style={{ width: `${p.costShare}%` }} />
                        </span>
                        <span className="text-secondary-text tabular-nums w-10 text-right">{p.costShare}%</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, accent, warn }) {
  return (
    <div className={`rounded-[12px] border p-4 ${warn ? "border-danger/40 bg-danger/5" : accent ? "border-primary/40 bg-primary-muted/20" : "border-divider bg-bg-card"}`}>
      <div className="text-xs text-secondary-text">{label}</div>
      <div className={`text-lg font-medium mt-1 tabular-nums ${warn ? "text-danger" : "text-primary-text"}`}>{value}</div>
      {sub && <div className="text-xs text-secondary-text mt-0.5">{sub}</div>}
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-sm ${color} inline-block`} />
      {label}
    </span>
  );
}
