"use client";
import Image from "next/image";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { previewUrl } from "@/lib/studio/image-url";

export default function StudioMessageHistory({ documentId, messages, zh, onImage, onError }) {
  const [older, setOlder] = useState([]), [cursor, setCursor] = useState(undefined), [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const query = new URLSearchParams(cursor ? { before: String(cursor) } : { beforeId: messages[0]?.id || "" });
      const data = await api(`/api/studio/documents/${documentId}/history?${query}`);
      setOlder(current => [...data.items.toReversed(), ...current].filter((item, index, all) => all.findIndex(row => row.id === item.id) === index));
      setCursor(data.nextCursor);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <>{documentId && cursor !== null && <button className="ms-text-button ms-history-more" disabled={busy} onClick={load}>{busy ? zh ? "正在加载…" : "Loading…" : zh ? "查看更早的对话" : "Load earlier conversation"}</button>}{older.filter(row => !messages.some(message => message.id === row.id)).map(message => <div className={`ms-message ${message.role}`} key={message.id}><p>{message.text}</p>{message.assetId && <button className="ms-message-image" onClick={() => onImage(message.assetId)}><Image unoptimized src={previewUrl(message.assetId, 320)} width={320} height={320} alt={zh ? "历史图片" : "Earlier image"} /></button>}</div>)}</>;
}
