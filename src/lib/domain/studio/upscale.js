import sharp from "sharp";
import { AppError } from "../../http.js";
import { upscaleChannelReady } from "../../studio/model-channels.js";
import { upscaleInputError } from "../../studio/upscale.js";
import { signedVisualHeaders } from "./volc-visual.js";
import { downloadProviderImage } from "../../infra/storage/download.js";

const maxBytes = 10 * 1024 * 1024;

export async function upscaleVolcImage(channel, image, { scale = 2 } = {}, signal) {
  if (!upscaleChannelReady(channel)) throw new AppError("UPSCALE_NOT_CONFIGURED", 503);
  const source = await sharp(image, { limitInputPixels: 40000000 }).metadata();
  const invalid = upscaleInputError({ ...source, bytes: image.length }, scale);
  if (invalid) throw new AppError(invalid, 422);
  // Current docs specify CVProcess. The older SDK also exposes OverResolutionV2.
  const endpoint = new URL(channel.baseURL || "https://visual.volcengineapi.com");
  endpoint.search = new URLSearchParams({ Action: "CVProcess", Version: "2022-08-31" }).toString();
  const body = JSON.stringify({ req_key: channel.model, binary_data_base64: [image.toString("base64")], return_url: false });
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: signal || AbortSignal.timeout(120000), headers: signedVisualHeaders(endpoint, body, channel.accessKeyId, channel.secretAccessKey), body });
  // Bound even a malformed provider response before parsing base64.
  if (Number(response.headers.get("content-length")) > 15 * 1024 * 1024) { await response.body?.cancel(); throw new AppError("INVALID_UPSCALE_RESULT", 502); }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("INVALID_UPSCALE_RESULT", 502);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 15 * 1024 * 1024) { await reader.cancel(); throw new AppError("INVALID_UPSCALE_RESULT", 502); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError("INVALID_UPSCALE_RESULT", 502); }
  if (!response.ok || payload.code !== 10000 || payload.data?.algorithm_base_resp?.status_code !== 0) throw new AppError("PROVIDER_REJECTED", response.status >= 500 ? 502 : response.ok ? 422 : response.status);
  const encoded = payload.data?.binary_data_base64?.[0];
  let result;
  if (typeof encoded === "string" && encoded.length) {
    if (encoded.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw new AppError("INVALID_UPSCALE_RESULT", 502);
    result = Buffer.from(encoded, "base64");
  } else if (payload.data?.image_urls?.[0]) result = await downloadProviderImage(payload.data.image_urls[0]);
  else throw new AppError("INVALID_UPSCALE_RESULT", 502);
  if (result.length > maxBytes) throw new AppError("INVALID_UPSCALE_RESULT", 502);
  const meta = await sharp(result, { limitInputPixels: 40000000 }).metadata();
  if (meta.width !== source.width * scale || meta.height !== source.height * scale) throw new AppError("UPSCALE_SIZE_MISMATCH", 502);
  return result;
}
