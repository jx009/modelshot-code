"use client";

import { useState } from "react";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import clsx from "clsx";
import { useAdminReason } from "@/hooks/useAdminReason";

const STATUS_META = {
  needs_review: { label: "需复查", cls: "bg-warning/15 text-warning border-warning/30" },
  completed: { label: "完成", cls: "bg-success/15 text-success border-success/30" },
  succeeded: { label: "完成", cls: "bg-success/15 text-success border-success/30" },
  failed: { label: "失败", cls: "bg-danger/15 text-danger border-danger/30" },
  processing: { label: "生成中", cls: "bg-primary/15 text-primary border-primary/30" },
};

export default function AdminTryons() {
  const { ask, dialog } = useAdminReason();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(null); // 点击放大的记录

  const params = new URLSearchParams({ page: String(page), limit: "20", status, q: query });
  const { data: response, loading, error, reload: load } = useRemoteResource(`/api/admin/tryons?${params}`);
  const data = response || { tryons: [], total: 0, page: 1, limit: 20, statusCounts: [], summary: null };

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
  const countOf = s => data.statusCounts.find(x => x.status === s)?.count || 0;

  const retry = async (id) => {
    const confirmation = await ask();
    if (!confirmation) return;
    try {
      const res = await fetch("/api/admin/tryons", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": confirmation.key },
        body: JSON.stringify({ id, reason: confirmation.reason }),
      });
      if (res.ok) {
        load();
      } else {
        alert(await res.text());
      }
    } catch { alert("Retry failed"); }
  };

  return (
    <div className="space-y-5">
      {dialog}
      {error && <p role="alert" className="text-sm text-danger">加载失败，请重新搜索。</p>}
      <div>
        <h1 className="text-lg font-black tracking-tight">生成记录审计</h1>
        <p className="text-xs text-secondary-text mt-1">
          共 {data.total} 条 · 待复查 {countOf("needs_review")} · 失败 {countOf("failed")}
        </p>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "", label: `全部 (${data.total})` },
          { id: "needs_review", label: `需复查 (${countOf("needs_review")})` },
          { id: "failed", label: `失败 (${countOf("failed")})` },
          { id: "completed", label: `完成 (${countOf("completed")})` },
          { id: "processing", label: `生成中 (${countOf("processing")})` },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => { setStatus(f.id); setPage(1); }}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-bold border transition-colors cursor-pointer",
              status === f.id
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-bg-card border-divider text-secondary-text hover:text-primary-text"
            )}
          >
            {f.label}
          </button>
        ))}
        <input
          value={q}
          onChange={e => { setQ(e.target.value); }}
          onKeyDown={e => { if (e.key === "Enter") { setPage(1); setQuery(q.trim()); load(); } }}
          placeholder="搜索用户邮箱…（回车）"
          className="bg-bg-card border border-divider rounded-full px-3 py-1.5 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
        />
      </div>

      {/* 聚合条：当前筛选口径 */}
      {data.summary && (
        <div className="flex gap-4 text-xs text-secondary-text bg-bg-card/60 border border-divider rounded-[10px] px-4 py-2.5">
          <span>共 <b className="text-primary-text tabular-nums">{data.total}</b> 条</span>
          <span>成功率 <b className="text-primary-text tabular-nums">{data.summary.successRate}%</b></span>
          <span>成本 <b className="text-primary-text tabular-nums">${Number(data.summary.totalCostUsd).toFixed(2)}</b></span>
          {data.summary.avgDurationMs > 0 && (
            <span>平均耗时 <b className="text-primary-text tabular-nums">{(data.summary.avgDurationMs / 1000).toFixed(1)}s</b></span>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-secondary-text text-sm">Loading...</div>
      ) : data.tryons.length === 0 ? (
        <div className="text-secondary-text text-sm py-8 text-center">暂无记录</div>
      ) : (
        <div className="bg-bg-card border border-divider rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-divider text-secondary-text">
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-wider">结果</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-wider">用户</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-wider">状态 / QA</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-wider">通道/成本</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-wider">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.tryons.map(t => {
                const sm = STATUS_META[t.status] || { label: t.status, cls: "bg-bg-page text-secondary-text border-divider" };
                return (
                  <tr key={t.id} className="border-b border-divider/50 last:border-0 hover:bg-bg-page/40 transition-colors">
                    <td className="px-4 py-3">
                      {t.resultImage ? (
                        <button onClick={() => setZoom(t)} className="cursor-pointer group relative" title="点击放大">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={t.resultImage} alt="result" className="w-12 h-16 object-cover rounded border border-divider group-hover:border-primary/50 transition-colors" />
                        </button>
                      ) : (
                        <div className="w-12 h-16 rounded border border-dashed border-divider flex flex-col items-center justify-center gap-1 text-[8px] text-secondary-text">
                          无图
                          {["queued", "running", "provider_pending", "reconciling"].includes(t.status) && (
                            <button
                              onClick={() => retry(t.id)}
                              className="px-1.5 py-0.5 rounded border border-primary/40 text-primary text-[9px] hover:bg-primary-muted cursor-pointer"
                            >重试</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold max-w-[160px] truncate">{t.userName || "—"}</div>
                      <div className="text-[10px] text-secondary-text max-w-[160px] truncate">{t.userEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx("px-2 py-0.5 rounded-full text-[10px] font-bold border", sm.cls)}>{sm.label}</span>
                      {t.qaScore !== null && t.qaScore !== undefined && (
                        <div className="text-[10px] text-secondary-text mt-1">QA {t.qaScore}{t.qaFlags && t.qaFlags !== "[]" ? ` · ${JSON.parse(t.qaFlags).join(",")}` : ""}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{t.provider || "—"}</div>
                      <div className="text-[10px] text-secondary-text">{t.costUsd ? `$${t.costUsd}` : "—"}{t.platformSpec ? ` · ${t.platformSpec}` : ""}</div>
                    </td>
                    <td className="px-4 py-3 text-secondary-text">
                      {new Date(t.createTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-divider bg-bg-card font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <span className="text-secondary-text">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-divider bg-bg-card font-bold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}

      {/* 放大查看 */}
      {zoom && (
        <div
          className="fixed inset-0 bg-bg-page/80 z-50 flex items-center justify-center p-8"
          onClick={() => setZoom(null)}
        >
          <div className="max-w-3xl w-full bg-bg-card border border-divider rounded-xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-3">
              <div className="text-xs text-secondary-text">
                <div className="font-bold text-primary-text text-sm">{zoom.userEmail}</div>
                <div className="mt-0.5">{zoom.provider} · ${zoom.costUsd || 0} · {zoom.platformSpec || "通用"}</div>
                {zoom.qaFlags && zoom.qaFlags !== "[]" && (
                  <div className="mt-1 text-warning">QA 标记：{JSON.parse(zoom.qaFlags).join(", ")}</div>
                )}
              </div>
              <button onClick={() => setZoom(null)} className="text-secondary-text hover:text-primary-text cursor-pointer text-sm">✕</button>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <div>
                <div className="text-[10px] uppercase font-bold text-secondary-text mb-1.5">服装输入</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={zoom.clothesImage} alt="garment" className="w-full rounded border border-divider object-cover" />
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-secondary-text mb-1.5">生成结果</div>
                {zoom.resultImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={zoom.resultImage} alt="result" className="w-full rounded border border-divider object-cover" />
                ) : (
                  <div className="aspect-[3/4] rounded border border-dashed border-divider flex items-center justify-center text-xs text-secondary-text">无结果图</div>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-secondary-text mb-1">Prompt</div>
              <div className="text-[10px] text-secondary-text bg-bg-page rounded p-2.5 max-h-24 overflow-y-auto leading-relaxed">{zoom.prompt}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
