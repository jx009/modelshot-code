"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/client-api";

export function announcementQrError(code) {
  if (code === "COS_NOT_ENABLED" || code === "COS_CREDENTIALS_REQUIRED") return "请先在存储配置中启用腾讯 COS 并填写密钥和存储桶。";
  if (code === "QR_STORAGE_CHANGED") return "COS 存储桶或路径已变更，请重新上传二维码并保存公告。";
  if (code === "QR_IMAGE_TOO_LARGE" || code === "PAYLOAD_TOO_LARGE") return "二维码图片不能超过 5 MB。";
  if (code === "QR_IMAGE_INVALID") return "请选择有效的 PNG、JPG 或 WebP 静态图片。";
  if (code === "ANNOUNCEMENT_UNAVAILABLE") return "此公告已更新或下线，请刷新页面。";
  return "二维码加载或上传失败，请重试；管理员可检查 COS 配置与权限。";
}

export default function AnnouncementQr({ announcement, admin = false, locale = "zh" }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const en = locale === "en";
  const endpoint = admin
    ? `/api/admin/announcements/qr?${new URLSearchParams(announcement.qrImage || {})}`
    : `/api/announcements/qr?id=${encodeURIComponent(announcement.id)}`;
  useEffect(() => {
    const abort = new AbortController();
    api(endpoint, { signal: abort.signal }).then(data => { if (!abort.signal.aborted) setUrl(data.url); })
      .catch(e => { if (!abort.signal.aborted) setError(en ? "Unable to load QR code. Please retry." : announcementQrError(e.code)); });
    return () => abort.abort();
  }, [endpoint, attempt, en]);
  return <div className="announcement-qr-image">
    {error ? <div role="alert"><p>{error}</p><button type="button" className="announcement-link" onClick={() => { setError(""); setUrl(""); setAttempt(value => value + 1); }}>{en ? "Retry" : "重新加载"}</button></div>
      : url ? <Image unoptimized src={url} width={360} height={360} alt={en ? "Group QR code" : "加群二维码"} onError={() => setError(en ? "Unable to load QR code. Please retry." : "二维码加载失败，请重新加载。")} />
        : <p role="status">{en ? "Loading QR code…" : "正在加载二维码…"}</p>}
  </div>;
}
