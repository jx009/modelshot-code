"use client";

import { useEffect, useState } from "react";
import { Layers3, Save } from "lucide-react";
import { useAdminReason } from "@/hooks/useAdminReason";

async function read(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.code || "配置保存失败，请重试。");
  return data;
}

export default function ResolutionPricingSettings() {
  const reason = useAdminReason();
  const [prices, setPrices] = useState(null), [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/resolution-pricing", { cache: "no-store", signal: controller.signal }).then(read).then(data => {
      setPrices(data.surcharges); setCanManage(data.canManage);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  async function save(event) {
    event.preventDefault();
    const operation = await reason.ask();
    if (!operation) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      await read(await fetch("/api/admin/resolution-pricing", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.key }, body: JSON.stringify({ surcharges: prices, reason: operation.reason }) }));
      setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="max-w-4xl space-y-6">
    {reason.dialog}
    <div><h1 className="flex items-center gap-3 text-xl font-semibold"><Layers3 size={23} />分辨率积分</h1><p className="mt-2 text-sm text-secondary-text">统一设置全站生图分辨率的附加积分，模型基础积分继续在「模型配置」中维护。</p></div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {!prices ? <p className="text-secondary-text" role="status">正在加载配置…</p> : <form onSubmit={save} className="rounded-2xl border border-divider bg-bg-card p-5 sm:p-6 space-y-6">
      <div className="rounded-xl border border-divider bg-bg-page p-4"><p className="font-medium">每张图片积分 = 模型基础积分 + 分辨率附加积分</p><p className="mt-2 text-xs text-secondary-text">多张图片按张数累加。图像编辑使用实际调用模型的基础积分；OCR、超清放大等独立工具维持原有固定积分。</p></div>
      <div className="grid gap-4 sm:grid-cols-3">{["1K", "2K", "4K"].map(resolution => <label key={resolution} className="block space-y-2"><span className="text-sm font-medium">{resolution} 附加积分</span><input type="number" min="0" max="100000" step="1" required disabled={!canManage || busy} value={prices[resolution]} onChange={event => { setPrices(current => ({ ...current, [resolution]: event.target.value === "" ? "" : Number(event.target.value) })); setSaved(false); }} className="w-full min-w-0 rounded-xl border border-divider bg-bg-page px-3 py-3 text-primary-text disabled:opacity-60" /><span className="block text-xs text-secondary-text">积分 / 张 · 0 表示不加收</span></label>)}</div>
      <p className="text-xs leading-relaxed text-secondary-text">未配置时附加积分为 0。修改后新任务使用最新价格，已提交任务按原价格结算和退款。</p>
      <div className="flex flex-wrap items-center gap-4"><button type="submit" disabled={!canManage || busy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-btn-text disabled:opacity-50"><Save size={16} />{busy ? "正在保存…" : "保存分辨率积分"}</button>{saved && <p role="status" className="text-sm text-secondary-text">已保存，新任务按模型基础积分加上分辨率附加积分计费。</p>}{!canManage && <p className="text-sm text-secondary-text">仅 ROOT 可以修改计费配置。</p>}</div>
    </form>}
  </div>;
}
