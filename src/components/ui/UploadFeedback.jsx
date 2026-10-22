"use client";

import Image from "next/image";
import "./upload-feedback.css";

export default function UploadFeedback({ items, onDismiss, zh, floating = false }) {
  if (!items.length) return null;
  return <section className={`upload-feedback${floating ? " upload-feedback-floating" : ""}`} aria-label={zh ? "图片上传状态" : "Image uploads"}>
    <ul>{items.map(item => <li key={item.id}>
      {item.url && <Image unoptimized src={item.url} width={48} height={48} alt={item.file.name} />}
      <div><span>{item.file.name}</span><small role="status">{item.status === "error" ? item.error || (zh ? "上传失败，请重试" : "Upload failed. Try again.") : item.status === "uploading" ? zh ? "上传并登记中…" : "Uploading and registering…" : zh ? "等待上传…" : "Waiting to upload…"}</small></div>
      {item.status === "error" && <button type="button" onClick={() => onDismiss(item.id)} aria-label={zh ? `移除失败上传：${item.file.name}` : `Dismiss failed upload: ${item.file.name}`}>×</button>}
    </li>)}</ul>
  </section>;
}
