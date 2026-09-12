"use client";

import { useState, useEffect } from "react";
import { LoaderCircle, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useAdminReason } from "@/hooks/useAdminReason";

/**
 * 模型通道管理 — 每通道一张卡：开关/默认/优先级/API Key（加密存储脱敏显示）/Base URL（中转站）/模型名/测试连接
 * 配置读取优先级：DB 配置（本页）> env 兜底
 */
export default function AdminProviders() {
  const reasonPrompt = useAdminReason();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState({}); // id -> { ok, durationMs, error }

  async function load() {
    try {
      const res = await fetch("/api/admin/providers");
      if (res.ok) setProviders(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const patch = async (id, data, note) => {
    const approval = await reasonPrompt.ask();
    if (!approval) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/admin/providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": approval.key },
        body: JSON.stringify({ id, ...data, reason: approval.reason }),
      });
      if (!res.ok) throw new Error();
      toast.success(note || "Saved");
      await load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const testConnection = async (id) => {
    setTestingId(id);
    setTestResult(t => ({ ...t, [id]: null }));
    try {
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      setTestResult(t => ({ ...t, [id]: data }));
      if (data.ok) toast.success(`Test passed in ${(data.durationMs / 1000).toFixed(1)}s`);
      else toast.error(data.error || "Test failed");
    } catch {
      toast.error("Test request failed");
    } finally {
      setTestingId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-secondary-text text-sm py-10"><LoaderCircle className="animate-spin" size={14} /> Loading providers…</div>;
  }

  return (
    <div className="space-y-5">
      {reasonPrompt.dialog}
      <div>
        <h1 className="text-base font-medium text-primary-text">模型通道</h1>
        <p className="text-xs text-secondary-text mt-1 leading-relaxed">
          生图调度的可用通道。Key 加密存储、界面脱敏；Base URL 留空 = 官方直连，填入 = 走 OpenAI 兼容中转站。
          优先级数字越小越靠前展示。任务固定使用报价时选择的通道。
        </p>
      </div>

      <div className="space-y-4">
        {providers.map(p => (
          <ProviderCard
            key={p.id}
            provider={p}
            saving={savingId === p.id}
            testing={testingId === p.id}
            testResult={testResult[p.id]}
            onPatch={patch}
            onTest={() => testConnection(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ provider: p, saving, testing, testResult, onPatch, onTest }) {
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState(p.config.baseURL || "");
  const [model, setModel] = useState(p.config.model || "");

  return (
    <div className={`rounded-[16px] border p-5 space-y-4 ${p.isDefault ? "border-primary/50 bg-primary-muted/20" : "border-divider bg-bg-card surface-lit"}`}>
      {/* 头部：名称 + 标记 + 开关 + 优先级 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-primary-text">{p.displayName}</span>
          {p.isDefault && <span className="text-xs font-medium text-primary bg-primary-muted border border-primary/30 rounded-full px-2 py-0.5">默认</span>}
          <span className="text-xs text-secondary-text tabular-nums">${p.costPerImage}/张</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-secondary-text">
            优先级
            <input
              type="number"
              min={1}
              defaultValue={p.priority}
              onBlur={e => {
                const v = parseInt(e.target.value, 10);
                if (v && v !== p.priority) onPatch(p.id, { priority: v }, "Priority updated");
              }}
              className="w-14 bg-bg-page border border-divider rounded px-2 py-1 text-xs text-primary-text tabular-nums"
            />
          </label>
          <button
            onClick={() => onPatch(p.id, { isDefault: true }, "Set as default")}
            disabled={p.isDefault}
            className="text-xs font-medium text-secondary-text hover:text-primary transition-colors cursor-pointer disabled:opacity-40"
          >
            设为默认
          </button>
          <button
            onClick={() => onPatch(p.id, { isActive: !p.isActive }, p.isActive ? "Disabled" : "Enabled")}
            className={`relative w-10 h-5.5 rounded-full transition-colors cursor-pointer ${p.isActive ? "bg-primary" : "bg-divider-strong"}`}
            aria-pressed={p.isActive}
            aria-label="toggle active"
          >
            <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-bg-page transition-transform ${p.isActive ? "translate-x-[18px]" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* 配置区 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="block text-xs text-secondary-text">
            API Key {p.config.hasKey && <span className="text-success">（已配置：{p.config.keyMasked}）</span>}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={p.config.hasKey ? "留空 = 不变更" : "sk-..."}
            className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-secondary-text">Base URL（中转站）<span className="block text-[10px] text-secondary-text/60 mt-0.5">填 API 前缀，需支持 /images/edits；粘贴完整 generations 地址也会自动规范化</span></label>
          <input
            type="url"
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            placeholder="留空 = 官方直连"
            className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-secondary-text">模型名覆盖</label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="默认（如 gpt-image-2）"
            className="w-full bg-bg-page border border-divider rounded-[10px] px-3 py-2 text-xs text-primary-text placeholder-secondary-text/50 focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* 操作 + 测试结果 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            onPatch(p.id, {
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              baseURL,
              model,
            }, "Channel config saved");
            setApiKey("");
          }}
          disabled={saving}
          className="h-9 px-4 rounded-[10px] bg-primary hover:bg-primary-hover text-primary-btn-text text-xs font-medium transition-all cursor-pointer btn-sheen disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {saving && <LoaderCircle size={12} className="animate-spin" />}
          保存配置
        </button>
        <button
          onClick={onTest}
          disabled={testing || !p.isActive}
          className="h-9 px-4 rounded-[10px] border border-divider hover:bg-bg-card-hover text-primary-text text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {testing ? <LoaderCircle size={12} className="animate-spin" /> : <Zap size={12} />}
          测试连接
        </button>
        {testResult && (
          <span className={`text-xs font-medium ${testResult.ok ? "text-success" : "text-danger"}`}>
            {testResult.ok
              ? `✓ ${testResult.durationMs}ms`
              : `✗ ${testResult.error || "failed"}`}
          </span>
        )}
      </div>
    </div>
  );
}
