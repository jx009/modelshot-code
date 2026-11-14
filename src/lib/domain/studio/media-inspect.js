import { AppError } from "../../http.js";

// 通过工具服务读取音视频时长与格式。上传素材、旁白配音和曲库共用，
// 结果用于签发 videoMediaProof，客户端不能篡改时长。
export async function inspectMediaBytes(bytes, extension, { toolsURL = process.env.STUDIO_TOOLS_URL, toolsKey = process.env.STUDIO_TOOLS_KEY, signal, fetcher = fetch } = {}) {
  if (!toolsURL || !toolsKey) throw new AppError("MOTION_RENDER_UNAVAILABLE", 503);
  const form = new FormData(); form.append("file", new Blob([bytes]), `input.${extension}`);
  const timeout = AbortSignal.timeout(40000);
  const response = await fetcher(`${toolsURL}/motion/inspect`, { method: "POST", headers: { Authorization: `Bearer ${toolsKey}` }, body: form, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new AppError(response.status === 429 ? "MOTION_RENDER_BUSY" : response.status === 503 ? "MOTION_RENDER_UNAVAILABLE" : "VIDEO_MEDIA_INVALID", response.status);
  const info = await response.json();
  if (!["audio", "video"].includes(info.type) || !info.contentType?.startsWith(`${info.type}/`) || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 1800) throw new AppError("VIDEO_MEDIA_INVALID", 422);
  return info;
}
