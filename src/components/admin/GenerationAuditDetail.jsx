"use client";

import { useRef, useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useRemoteResource } from "@/hooks/useRemoteResource";
import styles from "./GenerationAuditDetail.module.css";

export const AUDIT_STATUS = { succeeded: "完成", completed: "完成", failed: "失败", queued: "排队中", running: "生成中", processing: "生成中", provider_pending: "等待模型", reconciling: "结果核对中", cancel_requested: "取消中", cancelled: "已取消" };
const time = value => value ? new Date(value).toLocaleString("zh-CN") : "—";
const json = value => JSON.stringify(value, null, 2);

function TextBlock({ title, text }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const textRef = useRef(null);
  async function copy() {
    let done = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); done = true; } } catch { /* Fall back on HTTP deployments and denied clipboard access. */ }
    if (!done) {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(textRef.current); selection.removeAllRanges(); selection.addRange(range);
      try { done = document.execCommand("copy"); } catch { /* Leave the text selected for manual copying. */ }
    }
    setCopied(done); setCopyError(!done);
  }
  return <section className={styles.section}>
    <div className={styles.sectionHeading}><h3>{title}</h3>{text && <button type="button" onClick={copy}><Copy size={13} />{copied ? "已复制" : "复制"}</button>}</div>
    <div ref={textRef} className={styles.text}>{text || "该任务未记录文字提示词"}</div>
    {copyError && <p role="status">已选中文字，请按 Ctrl+C 或长按复制。</p>}
  </section>;
}

function MediaGallery({ title, items }) {
  return <section className={styles.section}>
    <div className={styles.sectionHeading}><h3>{title}</h3><span>{items.length} 个附件</span></div>
    {items.length ? <div className={styles.gallery}>{items.map((item, index) => <figure key={`${item.url}:${index}`}>
      <div className={styles.preview}>{item.unavailable ? <span>素材已删除或不可用</span> : item.contentType?.startsWith("video/")
        ? <video src={item.url} controls preload="metadata" aria-label={item.label} />
        : <a href={item.url} target="_blank" rel="noreferrer" aria-label={`查看原图：${item.label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.label} loading="lazy" />
        </a>}</div>
      <figcaption><strong>{item.label}</strong><small>{item.width && item.height ? `${item.width} × ${item.height}` : item.contentType}{item.bytes ? ` · ${(item.bytes / 1024 / 1024).toFixed(2)} MB` : ""}</small>
        {!item.unavailable && <a href={item.url} target="_blank" rel="noreferrer">打开原文件 <ExternalLink size={12} /></a>}
      </figcaption>
    </figure>)}</div> : <p className={styles.empty}>无{title}。文字任务或失败任务可能没有结果图片。</p>}
  </section>;
}

function JsonSection({ title, value }) {
  if (value == null) return null;
  return <details className={styles.json}><summary>{title}</summary><pre>{json(value)}</pre></details>;
}

export default function GenerationAuditDetail({ id, onClose }) {
  const { data, error, loading, reload } = useRemoteResource(`/api/admin/tryons/${encodeURIComponent(id)}`);
  const result = data?.resultData;
  const imageRequest = data?.steps?.find(step => step.kind === "studio-image-request")?.report;
  const recognizedText = result?.text || result?.ocr?.boxes?.map(box => box.text).join("\n");
  return <Modal label="生成任务审计详情" onClose={onClose} className={styles.dialog}>
    <header className={styles.header}><div><h2>生成任务审计详情</h2><p>{data ? `${data.toolLabel} · ${data.userEmail || data.userName || data.userId}` : id}</p></div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="关闭审计详情"><X size={20} /></button></header>
    <div className={styles.body}>
      {loading && <p role="status">正在加载任务、提示词和素材…</p>}
      {error && <div role="alert">详情加载失败，请重试。<button type="button" className="button" onClick={reload}>重新加载</button></div>}
      {!loading && !error && data && <>
        <dl className={styles.meta}>{[
          ["状态", AUDIT_STATUS[data.status] || data.status], ["工具 / 操作", data.toolLabel],
          ["模型", data.model], ["通道", data.provider], ["用户", `${data.userName || ""} ${data.userEmail || ""}`.trim()],
          ["积分 / 成本", `${data.creditCost ?? 0} 积分 · $${data.costUsd ?? 0}`],
          ["创建时间", time(data.createTime)], ["更新时间", time(data.updateTime)],
          ["耗时", data.durationMs != null ? `${(data.durationMs / 1000).toFixed(1)} 秒` : null],
          ["画面规格", data.params?.size || data.aspectRatio || data.platformSpec],
          ["任务 ID", data.id], ["用户 ID", data.userId], ["本站请求 ID", data.requestId], ["上游请求 ID", imageRequest?.response?.requestId], ["上游 HTTP 状态", imageRequest?.response?.status],
          ["画布 ID", data.documentId], ["项目 ID", data.projectId], ["批次 ID", data.batchJobId], ["重试来源", data.retryOfId],
          ["QA / 复核", data.qaStatus], ["QA 评分", data.qaScore],
        ].filter(([, value]) => value != null && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {data.errorCode && <div className={styles.error}><strong>{data.status === "reconciling" ? "结果尚未确认" : "失败原因"}</strong><code>{data.errorCode}</code>
          {data.status === "reconciling" && <p>请求可能已被模型服务接收，但本站尚未确认结果。为避免重复生成和扣费，不会自动重新提交；核对期结束仍无结果时，将释放本次预留积分。</p>}
        </div>}
        {data.inputNotRecorded && <p className={styles.notice}>这是一条旧版文字任务，当时未保存原始输入，无法补回；更新后的任务会保留完整输入。</p>}
        <TextBlock title="用户原始提示词" text={data.userPrompt} />
        {(imageRequest?.instruction || data.prompt !== data.userPrompt) && <TextBlock title="任务执行提示词" text={imageRequest?.instruction || data.prompt} />}
        <MediaGallery title="输入与参考图" items={data.inputs || []} />
        <MediaGallery title="生成结果" items={data.outputs || []} />
        {recognizedText && <TextBlock title={data.tool === "ocr" ? "识别文字" : "文字结果"} text={recognizedText} />}
        {result?.summary && <TextBlock title="任务回复" text={typeof result.summary === "string" ? result.summary : json(result.summary)} />}
        <JsonSection title="生成参数" value={data.params} />
        <JsonSection title="完整输入快照" value={data.snapshot} />
        <JsonSection title="完整结果（含 OCR / Agent / 规划数据）" value={result} />
        <JsonSection title="执行记录与错误" value={data.attempts} />
        <JsonSection title="处理步骤" value={data.steps} />
        <JsonSection title="质量检查与复核" value={{ score: data.qaScore, flags: data.qaFlags, decision: data.reviewDecision }} />
      </>}
    </div>
  </Modal>;
}
