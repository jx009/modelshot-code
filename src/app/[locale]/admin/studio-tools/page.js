"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Save, Wrench } from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "@/i18n/navigation";
import { useAdminReason } from "@/hooks/useAdminReason";

export default function StudioToolPricingPage() {
  const reasonPrompt = useAdminReason();
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(null);

  async function load() {
    const response = await fetch("/api/admin/studio-tools");
    if (!response.ok) throw new Error("LOAD_FAILED");
    setData(await response.json());
  }
  useEffect(() => { const timer = setTimeout(() => load().catch(() => toast.error("加载工具计费失败")), 0); return () => clearTimeout(timer); }, []);

  async function save(tool) {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSaving(tool.id);
    try {
      const response = await fetch("/api/admin/studio-tools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key },
        body: JSON.stringify({ toolId: tool.id, creditCost: Number(tool.creditCost), isEnabled: tool.isEnabled, channelName: tool.channelName || null, reason: approval.reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.code || "SAVE_FAILED");
      toast.success(`${tool.zh} 已更新`);
      await load();
    } catch (error) { toast.error(error.message || "保存失败"); }
    finally { setSaving(null); }
  }

  const update = (id, patch) => setData(current => ({ ...current, tools: current.tools.map(tool => tool.id === id ? { ...tool, ...patch } : tool) }));

  return (
    <div className=”space-y-5”>
      {reasonPrompt.dialog}
      <div>
        <h1 className=”text-base font-medium text-primary-text”>工具与计费</h1>
        <p className=”text-xs text-secondary-text mt-1 leading-relaxed max-w-4xl”>这里定义画布专业工具的单次积分和可用状态。快速生图、参考图编辑按所选模型通道的”每次模型请求积分”计费，可前往 <Link href=”/admin/providers” className=”text-primary”>模型通道</Link> 调整。需要外部模型的工具（如图层拆分、物体分割）可指定专用通道。</p>
      </div>
      {!data ? (
        <div className=”flex items-center gap-2 text-secondary-text text-sm py-10”>
          <LoaderCircle className=”animate-spin” size={14} />
          加载工具配置…
        </div>
      ) : (
        <div className=”grid grid-cols-1 lg:grid-cols-2 gap-3”>
          {data.tools.map(tool => {
            const needsChannel = tool.dependency === “split” || tool.preview === “segment”;
            const channelType = tool.dependency === “split” ? “split” : tool.preview === “segment” ? “segment” : null;
            const availableChannels = channelType ? data.channels[channelType] || [] : [];
            return (
              <div key={tool.id} className={`rounded-[14px] border p-4 bg-bg-card ${tool.isEnabled ? “border-divider” : “border-divider/60 opacity-70”}`}>
                <div className=”flex items-start justify-between gap-3”>
                  <div className=”flex gap-2.5”>
                    <span className=”w-8 h-8 rounded-[9px] bg-primary-muted text-primary grid place-items-center”>
                      <Wrench size={15} />
                    </span>
                    <div>
                      <h2 className=”text-sm font-medium text-primary-text”>{tool.zh}</h2>
                      <p className=”text-[10px] text-secondary-text mt-0.5”>{tool.en} · {tool.id} · {tool.dependency}</p>
                    </div>
                  </div>
                  <button
                    type=”button”
                    aria-pressed={tool.isEnabled}
                    onClick={() => update(tool.id, { isEnabled: !tool.isEnabled })}
                    className={`relative w-10 h-5.5 rounded-full ${tool.isEnabled ? “bg-primary” : “bg-divider-strong”}`}
                  >
                    <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-bg-page transition-transform ${tool.isEnabled ? “translate-x-[18px]” : “translate-x-0.5”}`} />
                  </button>
                </div>
                <div className=”flex flex-col gap-3 mt-4”>
                  <div className=”flex items-end gap-3”>
                    <label className=”flex-1 text-xs text-secondary-text space-y-1”>
                      <span>单次处理积分</span>
                      <input
                        type=”number”
                        min=”0”
                        max=”100000”
                        step=”1”
                        value={tool.creditCost}
                        onChange={event => update(tool.id, { creditCost: event.target.value })}
                        className=”w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-primary-text”
                      />
                    </label>
                    <button
                      onClick={() => save(tool)}
                      disabled={saving === tool.id}
                      className=”h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50”
                    >
                      {saving === tool.id ? <LoaderCircle size={13} className=”animate-spin” /> : <Save size={13} />}
                      保存
                    </button>
                  </div>
                  {needsChannel && (
                    <label className=”text-xs text-secondary-text space-y-1”>
                      <span>
                        专用模型通道
                        {availableChannels.length === 0 && <span className=”text-danger ml-1”>（无可用通道）</span>}
                      </span>
                      <select
                        value={tool.channelName || “”}
                        onChange={e => update(tool.id, { channelName: e.target.value || null })}
                        disabled={availableChannels.length === 0}
                        className=”w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-primary-text disabled:opacity-50”
                      >
                        <option value=””>沿用用户选择的生图模型</option>
                        {availableChannels.map(ch => (
                          <option key={ch.name} value={ch.name}>{ch.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
