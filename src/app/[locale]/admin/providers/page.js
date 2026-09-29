"use client";

import { cloneElement, useEffect, useState } from "react";
import { LoaderCircle, Plus, X, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";
import { CHANNEL_PRESETS, channelScope } from "@/lib/studio/model-channels";

const emptyChannel = { scope: "public", kind: "openai", studioCapability: "image", imageMode: "both", displayName: "", model: "", apiKey: "", accessKeyId: "", secretAccessKey: "", baseURL: "", creditCost: 18, costPerImage: 0.08 };

export default function AdminProviders() {
  const reasonPrompt = useAdminReason();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState({});
  const [category, setCategory] = useState("public");
  const [adding, setAdding] = useState(false);
  const [channel, setChannel] = useState(emptyChannel);

  async function load() {
    try {
      const requested = new URLSearchParams(window.location.search).get("category");
      if (["public", "language", "tool"].includes(requested)) setCategory(requested);
      const res = await fetch("/api/admin/providers");
      if (!res.ok) throw new Error();
      setProviders(await res.json());
    } catch { toast.error("加载模型配置失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, []);

  const patch = async (id, data, note) => {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/admin/providers", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key }, body: JSON.stringify({ id, ...data, reason: approval.reason }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.code || "SAVE_FAILED");
      toast.success(note || "配置已保存"); await load();
    } catch (error) { toast.error(error.message || "保存失败"); }
    finally { setSavingId(null); }
  };

  const create = async event => {
    event.preventDefault();
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSavingId("new");
    try {
      const res = await fetch("/api/admin/providers", { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key }, body: JSON.stringify({ ...channel, creditCost: Number(channel.creditCost), costPerImage: Number(channel.costPerImage), reason: approval.reason }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.code || "CREATE_FAILED");
      setChannel(emptyChannel); setAdding(false); toast.success("模型已添加"); await load();
    } catch (error) { toast.error(error.message || "新增失败"); }
    finally { setSavingId(null); }
  };

  const testConnection = async (id, mode = "image") => {
    const key = `${id}:${mode}`; setTestingId(key); setTestResult(value => ({ ...value, [key]: null }));
    try {
      const res = await fetch("/api/admin/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, mode }) });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      setTestResult(value => ({ ...value, [key]: data }));
      if (data.ok) toast.success(`连接测试通过：${data.durationMs}ms`);
      else toast.error(data.error || data.code || "测试失败");
    } catch { toast.error("测试请求失败"); }
    finally { setTestingId(null); }
  };

  if (loading) return <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} />加载模型配置…</div>;

  return <div className="space-y-5">
    {reasonPrompt.dialog}
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div><h1 className="text-base font-medium text-primary-text">模型配置</h1><p className="text-xs text-secondary-text mt-1 leading-relaxed max-w-4xl">生图模型供用户选择；后台大语言模型用于自动调用、反推提示词等场景。工具专用模型仅在后台绑定，不进入用户模型列表。测试会产生上游费用。</p></div>
      <button className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5" onClick={() => { setChannel({ ...emptyChannel, scope: category, studioCapability: category === "language" ? "language" : "image", creditCost: category === "language" ? 1 : 18 }); setAdding(true); }}><Plus size={14} />新增模型</button>
    </div>

    <div className="flex flex-wrap gap-2" role="tablist" aria-label="模型分类">{[["public", "生图模型"], ["language", "后台大语言模型"], ["tool", "工具专用模型"]].map(([id, label]) => <button key={id} role="tab" aria-selected={category === id} className={`px-4 py-2 rounded-[10px] text-sm border ${category === id ? "border-primary text-primary bg-primary-muted" : "border-divider text-secondary-text"}`} onClick={() => { setCategory(id); setAdding(false); }}>{label}</button>)}</div>
    <p className="text-xs text-secondary-text">{category === "public" ? "用户只在工作台选择这里的生图模型。" : category === "language" ? "只启用一个后台通用大语言模型。每次成功调用按这里的积分扣费，用户无需选模型。支持 OpenAI 兼容、阿里百炼和火山方舟。" : "这里保存工具内部使用的 API 配置；进入“工具配置”绑定到具体工具。火山智能视觉 EntitySegment 负责物体分割，图像编辑模型负责后续修改，Qwen Layered 负责拆层。"}</p>
    {adding && <form onSubmit={create} className="rounded-[16px] border border-primary/50 bg-primary-muted/20 p-5 space-y-4">
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-medium text-primary-text">新增模型</h2><p className="text-[11px] text-secondary-text mt-1">凭据、地址和实际模型名只在服务端使用。</p></div><button type="button" className="text-secondary-text" onClick={() => setAdding(false)}><X size={16} /></button></div>
      {category !== "language" && <Field label="配置预设"><select defaultValue="" onChange={e => { const preset = CHANNEL_PRESETS[Number(e.target.value)]; if (preset) { const { label, ...settings } = preset; setChannel({ ...emptyChannel, ...settings, scope: category, displayName: label }); } }}><option value="" disabled>选择供应商</option>{CHANNEL_PRESETS.map((preset, index) => (category === "tool" || preset.studioCapability === "image" && preset.imageMode !== "edit") && <option key={preset.label} value={index}>{preset.label}</option>)}</select></Field>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="协议类型"><select value={channel.kind} onChange={e => setChannel(value => ({ ...value, kind: e.target.value, studioCapability: category === "language" ? "language" : ["fal", "volc-visual"].includes(e.target.value) ? "segment" : "image", model: e.target.value === "volc-visual" ? "entity_seg" : "", baseURL: e.target.value === "dashscope" ? "https://dashscope.aliyuncs.com" : e.target.value === "volcengine" ? "https://ark.cn-beijing.volces.com/api/v3" : e.target.value === "volc-visual" ? "https://visual.volcengineapi.com" : e.target.value === "fal" ? "https://fal.run" : "" }))}><option value="openai">OpenAI 兼容</option><option value="dashscope">阿里百炼</option><option value="volcengine">火山方舟</option>{category === "tool" && <><option value="volc-visual">火山智能视觉</option><option value="fal">fal 托管推理</option></>}</select></Field>
        <Field label="显示名称"><input required value={channel.displayName} maxLength={100} onChange={e => setChannel(value => ({ ...value, displayName: e.target.value }))} placeholder="例如：ModelShot Pro" /></Field>
        <Field label="模型名 / 火山 Endpoint ID"><input required readOnly={channel.kind === "volc-visual"} value={channel.model} maxLength={128} onChange={e => setChannel(value => ({ ...value, model: e.target.value }))} placeholder="例如：gpt-image-2" /></Field>
        {channel.kind === "fal" && <Field label="专用服务"><select value={channel.studioCapability} onChange={e => setChannel(value => ({ ...value, studioCapability: e.target.value }))}><option value="segment">物体分割</option><option value="split">图层拆分</option></select></Field>}
        {channel.kind === "volc-visual" ? <><Field label="Access Key ID (AK)"><input required type="password" autoComplete="off" value={channel.accessKeyId} onChange={e => setChannel(value => ({ ...value, accessKeyId: e.target.value }))} /></Field><Field label="Secret Access Key (SK)"><input required type="password" autoComplete="off" value={channel.secretAccessKey} onChange={e => setChannel(value => ({ ...value, secretAccessKey: e.target.value }))} /></Field></> : <Field label="API Key"><input required type="password" value={channel.apiKey} maxLength={4096} onChange={e => setChannel(value => ({ ...value, apiKey: e.target.value }))} placeholder="sk-…" /></Field>}
        <Field label="Base URL"><input type="url" value={channel.baseURL} maxLength={500} onChange={e => setChannel(value => ({ ...value, baseURL: e.target.value }))} placeholder="留空使用官方地址" /></Field>
        <Field label="每次模型请求积分"><input type="number" min="0" max="100000" step="1" value={channel.creditCost} onChange={e => setChannel(value => ({ ...value, creditCost: e.target.value }))} /></Field>
      </div>
      <button disabled={savingId === "new"} className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5">{savingId === "new" && <LoaderCircle size={12} className="animate-spin" />}保存新模型</button>
    </form>}

    <div className="space-y-4">{providers.filter(provider => channelScope(provider, provider.config) === category && (!["gemini", "fashn"].includes(provider.kind) || provider.config.hasKey)).map(provider => <ProviderCard key={JSON.stringify(provider)} provider={provider} saving={savingId === provider.id} testingId={testingId} testResult={testResult} onPatch={patch} onTest={testConnection} />)}</div>
  </div>;
}

function Field({ label, children }) {
  return <label className="block text-xs text-secondary-text space-y-1"><span>{label}</span>{cloneElement(children, { className: `w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text focus:outline-none focus:border-primary/50 ${children.props.className || ""}` })}</label>;
}

function ProviderCard({ provider: p, saving, testingId, testResult, onPatch, onTest }) {
  const [apiKey, setApiKey] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [displayName, setDisplayName] = useState(p.displayName);
  const [baseURL, setBaseURL] = useState(p.config.baseURL || "");
  const [model, setModel] = useState(p.config.model || "");
  const scope = channelScope(p, p.config);
  const [selectedScope, setSelectedScope] = useState(scope);
  const [creditCost, setCreditCost] = useState(p.creditCost);
  const [costPerImage, setCost] = useState(p.costPerImage);
  const testMode = scope === "language" ? "planner" : "image", imageTest = testResult[`${p.id}:${testMode}`];
  const save = () => { onPatch(p.id, { displayName: displayName.trim(), creditCost: Number(creditCost), costPerImage: Number(costPerImage), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(accessKeyId.trim() ? { accessKeyId: accessKeyId.trim() } : {}), ...(secretAccessKey.trim() ? { secretAccessKey: secretAccessKey.trim() } : {}), baseURL, model, scope: selectedScope, studioCapability: selectedScope === "language" ? "language" : p.config.studioCapability === "language" ? "image" : p.config.studioCapability, ...(selectedScope === "language" ? { isPlanner: true } : p.isPlanner ? { isPlanner: false } : {}) }, "模型配置已保存"); setApiKey(""); setAccessKeyId(""); setSecretAccessKey(""); };

  return <div className={`rounded-[16px] border p-5 space-y-4 ${(p.config.studioDefault || p.isDefault) ? "border-primary/50 bg-primary-muted/20" : "border-divider bg-bg-card surface-lit"}`}>
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5 flex-wrap"><span className="text-sm font-medium text-primary-text">{p.displayName}</span><span className="text-[10px] uppercase text-secondary-text border border-divider rounded px-1.5 py-0.5">{p.kind}</span>{p.isDefault && <Badge>电商默认</Badge>}{p.config.studioDefault && scope === "public" && <Badge>默认生图模型</Badge>}{p.isPlanner && <Badge>后台自动调用</Badge>}<span className="text-xs text-secondary-text">{scope === "language" ? `${p.creditCost} 积分/次` : `$${p.costPerImage}/次`}</span></div>
      <div className="flex items-center gap-3 flex-wrap"><label className="flex items-center gap-1.5 text-xs text-secondary-text">优先级<input type="number" min={1} defaultValue={p.priority} onBlur={e => { const value = Number(e.target.value); if (value && value !== p.priority) onPatch(p.id, { priority: value }, "优先级已更新"); }} className="w-14" /></label>{scope === "public" && <button onClick={() => onPatch(p.id, { studioDefault: true })} disabled={p.config.studioDefault} className="text-xs text-secondary-text disabled:opacity-40">设为默认</button>}{scope === "language" && <button onClick={() => onPatch(p.id, { isPlanner: true })} disabled={p.isPlanner} className="text-xs text-secondary-text disabled:opacity-40">设为后台通用模型</button>}<button onClick={() => onPatch(p.id, { isActive: !p.isActive }, p.isActive ? "已停用" : "已启用")} className={`relative w-10 h-5.5 rounded-full ${p.isActive ? "bg-primary" : "bg-divider-strong"}`} aria-label={`启用 ${p.displayName}`} aria-pressed={p.isActive}><span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-bg-page transition-transform ${p.isActive ? "translate-x-[18px]" : "translate-x-0.5"}`} /></button></div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label="显示名称（模型映射名）"><input value={displayName} maxLength={100} onChange={e => setDisplayName(e.target.value)} placeholder="用户看到的名称" /></Field>
      <Field label="模型名 / 火山 Endpoint ID"><input readOnly={p.kind === "volc-visual"} value={model} maxLength={128} onChange={e => setModel(e.target.value)} placeholder="例如：gpt-image-2" /></Field>
      {["image", "language"].includes(p.config.studioCapability) && <Field label="用途"><select value={selectedScope} onChange={e => setSelectedScope(e.target.value)}><option value="public">生图模型 · 用户可选</option><option value="language">后台大语言模型 · 自动调用</option><option value="tool">工具专用模型 · 后台绑定</option></select></Field>}
      {p.kind === "volc-visual" ? <><Field label={`Access Key ID (AK)${p.config.hasAccessKey ? " · 已配置" : ""}`}><input type="password" autoComplete="off" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} placeholder={p.config.hasAccessKey ? "留空不变更" : "填写 AK"} /></Field><Field label={`Secret Access Key (SK)${p.config.hasSecretKey ? " · 已配置" : ""}`}><input type="password" autoComplete="off" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} placeholder={p.config.hasSecretKey ? "留空不变更" : "填写 SK"} /></Field></> : <Field label={<>API Key {p.config.hasKey && <span className="text-success">（{p.config.keyMasked}）</span>}</>}><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={p.config.hasKey ? "留空不变更" : "sk-…"} /></Field>}
      <Field label="Base URL（对应协议地址）"><input type="url" value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="留空使用官方地址" /></Field>
      <Field label="每次模型请求积分"><input type="number" min="0" max="100000" step="1" value={creditCost} onChange={e => setCreditCost(e.target.value)} /></Field>
      {scope !== "language" && <Field label="预估成本（美元/次）"><input type="number" min="0" step="0.001" value={costPerImage} onChange={e => setCost(e.target.value)} /></Field>}
    </div>
    <div className="flex items-center gap-3 flex-wrap"><button onClick={save} disabled={saving || !displayName.trim() || !model.trim()} className="h-9 px-4 rounded-[10px] bg-primary text-primary-btn-text text-xs font-medium inline-flex items-center gap-1.5">{saving && <LoaderCircle size={12} className="animate-spin" />}保存配置</button><TestButton label="测试功能（产生上游费用）" busy={testingId === `${p.id}:${testMode}`} disabled={!p.isActive} result={imageTest} onClick={() => onTest(p.id, testMode)} /></div>
  </div>;
}

function Badge({ children }) { return <span className="text-xs font-medium text-primary bg-primary-muted border border-primary/30 rounded-full px-2 py-0.5">{children}</span>; }
function TestButton({ label, busy, disabled, result, onClick }) { return <><button onClick={onClick} disabled={busy || disabled} className="h-9 px-4 rounded-[10px] border border-divider text-primary-text text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50">{busy ? <LoaderCircle size={12} className="animate-spin" /> : <Zap size={12} />}{label}</button>{result && <span className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.ok ? `✓ ${result.durationMs}ms` : `✗ ${result.error || result.code || "failed"}`}</span>}</>; }
