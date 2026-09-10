"use client";

import { useEffect, useState } from "react";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(r => (r.ok ? r.json() : Promise.reject("Failed to load")))
      .then(setStats)
      .catch(e => setError(String(e)));
  }, []);

  if (error) return <div className="text-danger text-sm">{error}</div>;
  if (!stats) return <div className="text-secondary-text text-sm">Loading...</div>;

  const cards = [
    { label: "总用户", value: stats.totalUsers, sub: `今日 +${stats.todayNewUsers ?? 0}` },
    { label: "今日生成", value: stats.todayTryons, sub: `累计 ${stats.totalTryons}` },
    { label: "今日收入", value: `$${(stats.todayRevenue ?? 0).toFixed(2)}`, sub: "paid 订单" },
    { label: "今日成本", value: `$${stats.todayCostUsd ?? 0}`, sub: `累计 $${stats.totalCostUsd}` },
    { label: "待人工复查", value: stats.needsReview, sub: "QA 未通过" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-black tracking-tight">数据看板</h1>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-bg-card border border-divider rounded-xl p-4">
            <div className="text-[10px] uppercase font-bold text-secondary-text tracking-wider">{c.label}</div>
            <div className="text-2xl font-black mt-1.5">{c.value}</div>
            {c.sub && <div className="text-[10px] text-secondary-text mt-1">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* 14 天生成趋势（纯 CSS 柱状，成功/失败双色） */}
      {stats.trend && stats.trend.length > 0 && (
        <div className="bg-bg-card border border-divider rounded-xl p-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-secondary-text mb-3">14 天生成趋势</h2>
          <div className="flex items-end gap-1.5 h-24">
            {stats.trend.map(d => {
              const max = Math.max(...stats.trend.map(x => x.success + x.failed), 1);
              const h = v => `${Math.max(2, (v / max) * 100)}%`;
              return (
                <div key={d.date} className="flex-1 flex flex-col justify-end gap-px" title={`${d.date} 成功${d.success} 失败${d.failed}`}>
                  <div className="rounded-t bg-danger/70" style={{ height: h(d.failed) }} />
                  <div className="rounded-t bg-primary" style={{ height: h(d.success) }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-secondary-text mt-1.5">
            <span>{stats.trend[0]?.date}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary inline-block" />成功</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-danger/70 inline-block" />失败</span>
            </span>
            <span>{stats.trend[stats.trend.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* 通道健康（近 24h） */}
      {stats.providerHealth && stats.providerHealth.length > 0 && (
        <div className="bg-bg-card border border-divider rounded-xl p-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-secondary-text mb-3">通道健康（近 24h）</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {stats.providerHealth.map(p => {
              const failRate = p.count > 0 ? (p.failed / p.count * 100).toFixed(1) : "0";
              const bad = p.count > 0 && p.failed / p.count > 0.1;
              return (
                <div key={p.provider} className="border border-divider rounded-[10px] p-3">
                  <div className="text-sm font-bold">{p.provider}</div>
                  <div className="text-xs text-secondary-text mt-1 tabular-nums">{p.count} 次 · 平均 {(p.avgDurationMs / 1000).toFixed(1)}s</div>
                  <div className={`text-xs mt-0.5 tabular-nums ${bad ? "text-danger" : "text-success"}`}>失败率 {failRate}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-bg-card border border-divider rounded-xl p-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-secondary-text mb-3">模型使用分布</h2>
          {stats.providerDistribution.length === 0 ? (
            <p className="text-xs text-secondary-text">暂无数据</p>
          ) : (
            stats.providerDistribution.map(p => {
              const total = stats.providerDistribution.reduce((s, x) => s + x.count, 0);
              const pct = Math.round((p.count / total) * 100);
              return (
                <div key={p.provider} className="mb-2.5">
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span>{p.provider}</span>
                    <span className="text-secondary-text">{p.count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-bg-page rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="bg-bg-card border border-divider rounded-xl p-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-secondary-text mb-3">生成状态分布</h2>
          {stats.statusDistribution.map(s => (
            <div key={s.status} className="flex justify-between text-xs font-bold py-1.5 border-b border-divider/50 last:border-0">
              <span>{s.status}</span>
              <span className="text-secondary-text">{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
