"use client";
import { useRef, useState } from "react";
import { LoaderCircle, WandSparkles, X } from "lucide-react";
import { api, requestKey } from "@/lib/client-api";
import Modal from "@/components/ui/Modal";

export default function PromptOptimizer({ prompt, disabled, available, cost, zh, onApply, onCharged }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState(null), [error, setError] = useState("");
  const attempt = useRef(null), lock = useRef(false);
  async function optimize() {
    if (lock.current || !prompt.trim()) return;
    lock.current = true; setBusy(true); setError("");
    const text = prompt.trim();
    if (attempt.current?.prompt !== text) attempt.current = { prompt: text, key: requestKey() };
    try {
      const data = await api("/api/studio/optimize", { method: "POST", key: attempt.current.key, body: { prompt: text } });
      setResult(data.prompt); onCharged?.();
    } catch (err) {
      setError(err.code || err.message);
      if (err.code && err.code !== "REQUEST_IN_PROGRESS" && err.code !== "REQUEST_FAILED") attempt.current = null;
    }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button className="ms-text-button" disabled={disabled || busy || !available || !prompt.trim()} onClick={optimize} title={available ? zh ? "使用后台语言模型优化，生成成功后扣费" : "Uses the configured language model; charged on success" : zh ? "管理员尚未配置后台语言模型" : "No backend language model configured"}>
      {busy ? <LoaderCircle size={13} className="ms-spin" /> : <WandSparkles size={13} />}{busy ? zh ? "正在优化…" : "Improving…" : zh ? `优化提示词 · ${cost} 积分` : `Improve prompt · ${cost} credits`}
    </button>
    {error && <span role="alert">{zh ? "优化失败，原文已保留：" : "Optimization failed; original kept: "}{error}</span>}
    {result !== null && <Modal label={zh ? "优化后的提示词" : "Improved prompt"} onClose={() => setResult(null)}><div className="ms-export-dialog">
      <header><h2>{zh ? "优化后的提示词" : "Improved prompt"}</h2><button className="ms-icon" aria-label={zh ? "关闭" : "Close"} onClick={() => setResult(null)}><X size={18} /></button></header>
      <textarea aria-label={zh ? "优化结果" : "Improved text"} rows={8} maxLength={4000} value={result} onChange={event => setResult(event.target.value)} style={{ width: "100%", padding: 12 }} />
      <p>{zh ? "确认后替换输入框；固定提示词和图片引用会保留。" : "Apply replaces the composer text and preserves fixed instructions and references."}</p>
      <button className="ms-button ms-primary" disabled={!result.trim()} onClick={() => { onApply(result); setResult(null); }}>{zh ? "应用提示词" : "Apply prompt"}</button>
    </div></Modal>}
  </>;
}
