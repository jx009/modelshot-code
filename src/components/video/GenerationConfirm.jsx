"use client";
import { useEffect, useState } from "react";
import { X, LoaderCircle, Clapperboard, RefreshCw } from "lucide-react";
import CreditIcon from "@/components/ui/CreditIcon";
import { videoMessage } from "@/lib/video/messages";

const TOOL_LABEL = { generate: ["首帧图", "Frame"], video: ["视频片段", "Clip"], tts: ["旁白配音", "Voiceover"], "motion-render": ["合成成片", "Render"] };

// 生成确认单：逐项列出将要调用的模型与积分，用户确认总价后才提交。
export default function GenerationConfirm({ open, onClose, sceneIds, quote, start, videoModels = [], defaultProvider, busy, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const [provider, setProvider] = useState(defaultProvider || "");
  const [quoted, setQuoted] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) { setLoading(true); setError(""); } })
      .then(() => quote(sceneIds, provider || undefined))
      .then(result => { if (!cancelled) setQuoted(result); })
      .catch(failure => { if (!cancelled) { setQuoted(null); setError(failure.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, sceneIds, provider, quote, revision]);
  if (!open) return null;
  async function confirm() {
    const created = await start({ sceneIds, provider: provider || undefined, quoted });
    if (created) onClose();
    else setRevision(value => value + 1);
  }
  const groups = [];
  for (const line of quoted?.lines || []) {
    const group = groups.find(item => item.sceneId === line.sceneId && line.sceneId);
    if (group) group.lines.push(line); else groups.push({ sceneId: line.sceneId, lines: [line] });
  }
  return <div className="sb-confirm-layer" role="presentation" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className="sb-confirm" role="dialog" aria-modal="true" aria-label={text("视频生成确认", "Confirm generation")}>
      <header><div><h2>{text("视频生成确认", "Confirm generation")}</h2><p>{text(`共 ${sceneIds.length} 个镜头，生成完成后自动合成成片。`, `${sceneIds.length} shots, rendered into one video when done.`)}</p></div><button type="button" aria-label={text("关闭", "Close")} disabled={busy} onClick={onClose}><X size={18} /></button></header>
      {videoModels.length > 1 && <label className="sb-field sb-confirm-model"><span>{text("视频模型", "Video model")}</span><select value={provider} disabled={loading || busy} onChange={event => setProvider(event.target.value)}>{videoModels.map(model => <option key={model.id} value={model.id}>{model.label} · {model.cost} {text("积分/条", "credits / clip")}</option>)}</select></label>}
      <div className="sb-confirm-body">
        {loading ? <p className="sb-confirm-status" role="status"><LoaderCircle size={16} className="vm-spin" />{text("正在计算费用…", "Calculating cost…")}</p>
          : error ? <div className="sb-confirm-error" role="alert"><p>{zh ? videoMessage(error, true) : error}</p><button type="button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />{text("重新报价", "Quote again")}</button></div>
          : <ol className="sb-quote">{groups.map((group, index) => <li key={group.sceneId || `render-${index}`}>
            <strong>{group.lines[0].label.split(" · ")[0]}</strong>
            <ul>{group.lines.map((line, position) => <li key={position}><span>{zh ? TOOL_LABEL[line.tool]?.[0] : TOOL_LABEL[line.tool]?.[1]}{(() => { const detail = line.label.split(" · ").slice(1).join(" · "); return detail && detail !== TOOL_LABEL[line.tool]?.[0] && !detail.endsWith(TOOL_LABEL[line.tool]?.[0] || "-") ? <small>{detail}</small> : null; })()}</span><b>{line.cost ? <><CreditIcon size={12} />{line.cost}</> : text("免费", "Free")}</b></li>)}</ul>
          </li>)}</ol>}
      </div>
      <footer>
        <p>{text("单个步骤失败时，该步骤积分按任务结算规则退回，可在分镜表中重试。", "Failed steps are refunded per the task rules and can be retried.")}</p>
        <button type="button" className="sb-primary" disabled={loading || busy || !quoted} onClick={confirm}>{busy ? <LoaderCircle size={16} className="vm-spin" /> : <Clapperboard size={16} />}{text("确认生成", "Generate")}{quoted && <span className="sb-cost"><CreditIcon size={13} />{quoted.total}</span>}</button>
      </footer>
    </aside>
  </div>;
}
