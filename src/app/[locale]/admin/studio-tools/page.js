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
        body: JSON.stringify({ toolId: tool.id, creditCost: Number(tool.creditCost), isEnabled: tool.isEnabled, routing: tool.routing, reason: approval.reason }),
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
    <div className="space-y-5">
      {reasonPrompt.dialog}
      <div>
        <h1 className="text-base font-medium text-primary-text">工具配置</h1>
        <p className="text-xs text-secondary-text mt-1 leading-relaxed max-w-4xl">逐个设置工具的执行方式、模型和积分。生图模型由用户选择，大语言模型在后台统一调用。<Link href="/admin/providers?category=tool" className="text-primary">添加工具专用模型 →</Link> 分割预览暂不扣用户积分，上游费用由平台承担；确认工具处理成功后按本页积分扣费。</p>
      </div>
      {!data ? (
        <div className="flex items-center gap-2 text-secondary-text text-sm py-10">
          <LoaderCircle className="animate-spin" size={14} />
          加载工具配置…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.tools.map(tool => {
            const modelTool = tool.dependency === "image" || tool.dependency === "split";
            const updateRouting = patch => update(tool.id, { routing: { ...tool.routing, ...patch } });
            const channelSelect = (cap, value, onChange, placeholder) => <select value={value || ""} onChange={e => onChange(e.target.value || null)} className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-primary-text"><option value="">{placeholder}</option>{(data.channels[cap] || []).map(ch => <option key={ch.name} value={ch.name}>{ch.label} · {ch.kind}</option>)}</select>;
            return (
              <div key={tool.id} className={`rounded-[14px] border p-4 bg-bg-card ${tool.isEnabled ? "border-divider" : "border-divider/60 opacity-70"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-2.5">
                    <span className="w-8 h-8 rounded-[9px] bg-primary-muted text-primary grid place-items-center">
                      <Wrench size={15} />
                    </span>
                    <div>
                      <h2 className="text-sm font-medium text-primary-text">{tool.zh}</h2>
                      <p className="text-[10px] text-secondary-text mt-0.5">{tool.dependency === "local" ? "纯代码处理 · 无需模型" : tool.dependency === "vision" ? "自动调用后台通用大语言模型" : tool.dependency === "image" ? "图像模型处理" : tool.dependency === "split" ? "拆分为独立 RGBA 图层" : "使用已部署的专用服务"}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`启用 ${tool.zh}`} aria-pressed={tool.isEnabled}
                    onClick={() => update(tool.id, { isEnabled: !tool.isEnabled })}
                    className={`relative w-10 h-5.5 rounded-full ${tool.isEnabled ? "bg-primary" : "bg-divider-strong"}`}
                  >
                    <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-bg-page transition-transform ${tool.isEnabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <div className="flex flex-col gap-3 mt-4">
                  <div className="flex items-end gap-3">
                    <label className="flex-1 text-xs text-secondary-text space-y-1">
                      <span>{tool.dependency === "vision" ? "积分在后台大语言模型中设置" : "单次处理积分"}</span>
                      <input
                        type="number"
                        min="0"
                        max="100000"
                        step="1"
                        disabled={tool.dependency === "vision"}
                        value={tool.creditCost}
                        onChange={event => update(tool.id, { creditCost: event.target.value })}
                        className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-primary-text"
                      />
                    </label>
                    <button
                      onClick={() => save(tool)}
                      disabled={saving === tool.id}
                      className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {saving === tool.id ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
                      保存
                    </button>
                  </div>
                  {modelTool && <label className="text-xs text-secondary-text space-y-1"><span>{tool.id === "move" ? "背景修复模型（移动后补全原位置）" : "执行方式"}</span><select className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-primary-text" value={tool.routing.mode} onChange={e => updateRouting({ mode: e.target.value, channelName: null })}>{tool.dependency === "image" && <option value="inherit">沿用用户选择的生图模型</option>}<option value="dedicated">指定工具专用模型</option></select></label>}
                  {modelTool && tool.routing.mode === "dedicated" && <label className="text-xs text-secondary-text space-y-1"><span>专用模型</span>{channelSelect(tool.dependency, tool.routing.channelName, channelName => updateRouting({ channelName }), tool.dependency === "split" ? "使用后台默认拆层模型" : "请选择模型")}</label>}
                  {tool.preview === "segment" && <><label className="text-xs text-secondary-text space-y-1"><span>物体分割（圈选时生成透明物体）</span><select className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-primary-text" value={tool.routing.segmentMode} onChange={e => updateRouting({ segmentMode: e.target.value, segmentChannelName: null })}><option value="default">后台默认分割服务</option><option value="dedicated">指定云端分割模型</option><option value="local">已部署的本地分割服务</option></select></label>{tool.routing.segmentMode === "dedicated" && <label className="text-xs text-secondary-text space-y-1"><span>分割模型</span>{channelSelect("segment", tool.routing.segmentChannelName, segmentChannelName => updateRouting({ segmentChannelName }), "请选择分割模型")}</label>}<p className="text-xs text-secondary-text">分割与图像修复是两个步骤。阿里 Qwen / 火山 Seedream 用于修复和局部修改，不能直接替代输出透明蒙版的分割模型。</p></>}
                  {tool.dependency === "vision" && <Link href="/admin/providers?category=language" className="text-xs text-primary">配置后台大语言模型和每次积分 →</Link>}
                  {!["image", "split", "vision", "local"].includes(tool.dependency) && <p className="text-xs text-secondary-text">{tool.dependency === "video" ? "当前接入火山视频服务，使用部署配置 ARK_VIDEO_MODEL。" : "当前由 tools 服务执行本地推理，使用已部署的模型。此工具尚未接入可切换的云端协议。"}</p>}

                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
