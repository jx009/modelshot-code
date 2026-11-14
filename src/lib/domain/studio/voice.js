import { AppError } from "../../http.js";
import { validVoiceOptions } from "../../studio/model-channels.js";

// 旁白配音（TTS）：OpenAI 兼容 /v1/audio/speech。接口路径由代码决定，
// 模型 ID 与可用音色由管理员在后台配置；用户只能从已配置的音色中选择。
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;
export const VOICE_TEXT_MAX = 400;

export function voiceBase(value) {
  if (!value) throw new AppError("SERVICE_NOT_CONFIGURED", 503);
  return value.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function looksLikeMp3(bytes) {
  if (bytes.length < 4) return false;
  if (bytes.toString("ascii", 0, 3) === "ID3") return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

export async function synthesizeSpeech(channel, { text, voice, signal }, { fetcher = fetch } = {}) {
  if (!channel?.apiKey || !channel.model || !channel.baseURL || !validVoiceOptions(channel.voiceOptions)) throw new AppError("VOICE_NOT_CONFIGURED", 503);
  const input = String(text || "").trim();
  if (!input || input.length > VOICE_TEXT_MAX) throw new AppError("VOICEOVER_TEXT_REQUIRED", 422);
  if (!channel.voiceOptions.voices.some(item => item.id === voice)) throw new AppError("VOICE_UNSUPPORTED", 422);
  const response = await fetcher(`${voiceBase(channel.baseURL)}/v1/audio/speech`, { method: "POST", redirect: "manual", signal,
    headers: { Authorization: `Bearer ${channel.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: channel.model, input, voice, response_format: "mp3" }) });
  if (!response.ok) throw new AppError("VOICE_PROVIDER_REJECTED", response.status >= 400 && response.status < 600 ? response.status : 502);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > VOICE_MAX_BYTES) throw new AppError("VOICE_RESULT_TOO_LARGE", 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > VOICE_MAX_BYTES) throw new AppError("VOICE_RESULT_TOO_LARGE", 502);
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  if (!looksLikeMp3(bytes)) throw new AppError("VOICE_RESULT_INVALID", 502);
  return bytes;
}
