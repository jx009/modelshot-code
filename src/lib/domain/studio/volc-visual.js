import { createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import { AppError } from "../../http.js";
import { maskPixels } from "./pixels.js";
import { segmentMaskScore } from "./segmentation.js";
import { segmentChannelReady } from "../../studio/model-channels.js";

const maxBytes = 10 * 1024 * 1024;
const hash = value => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

export function signedVisualHeaders(endpoint, body, accessKeyId, secretAccessKey, now = new Date()) {
  const datetime = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = datetime.slice(0, 8);
  const scope = `${date}/cn-north-1/cv/request`;
  const contentHash = hash(body);
  const headers = { Host: endpoint.host, "X-Date": datetime, "X-Content-Sha256": contentHash, "Content-Type": "application/json" };
  const canonical = `POST\n${endpoint.pathname}\n${endpoint.searchParams.toString()}\nhost:${endpoint.host}\nx-content-sha256:${contentHash}\nx-date:${datetime}\n\nhost;x-content-sha256;x-date\n${contentHash}`;
  const toSign = `HMAC-SHA256\n${datetime}\n${scope}\n${hash(canonical)}`;
  const signingKey = hmac(hmac(hmac(hmac(secretAccessKey, date), "cn-north-1"), "cv"), "request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.Authorization = `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=host;x-content-sha256;x-date, Signature=${signature}`;
  return headers;
}

export async function entityLabels(channel, image, signal) {
  if (!segmentChannelReady(channel)) throw new AppError("SEGMENTATION_NOT_CONFIGURED", 503);
  const endpoint = new URL(channel.baseURL || "https://visual.volcengineapi.com");
  endpoint.search = new URLSearchParams({ Action: "EntitySegment", Version: "2022-08-31" }).toString();
  const body = JSON.stringify({ binary_data_base64: [image.toString("base64")], req_key: "entity_seg", return_url: false, max_entity: 20, return_format: 0, refine_mask: 0 });
  const headers = signedVisualHeaders(endpoint, body, channel.accessKeyId, channel.secretAccessKey);
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: signal || AbortSignal.timeout(45000), headers, body });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.code !== 10000 || data.data?.algorithm_base_resp?.status_code !== 0) throw new AppError("PROVIDER_REJECTED", response.status >= 500 ? 502 : response.ok ? 422 : response.status);
  const encoded = data.data?.binary_data_base64?.[0];
  if (typeof encoded !== "string" || !encoded.length || encoded.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw new AppError("INVALID_SEGMENT_RESULT", 502);
  return Buffer.from(encoded, "base64");
}

async function decodeEntityLabels(labels, width, height) {
  const input = sharp(labels, { limitInputPixels: 40000000 });
  const meta = await input.metadata();
  if (meta.format !== "png" || meta.width !== width || meta.height !== height || meta.space !== "b-w" || meta.hasAlpha) throw new AppError("INVALID_SEGMENT_RESULT", 502);
  const pixels = await input.extractChannel(0).raw().toBuffer();
  if (pixels.length !== width * height) throw new AppError("INVALID_SEGMENT_RESULT", 502);
  return pixels;
}

export async function selectEntityMask(labels, selection, width, height, selectionBytes) {
  const pixels = await decodeEntityLabels(labels, width, height);
  const selected = selection.box && selectionBytes ? await maskPixels(selectionBytes, width, height) : null;
  let best = null, bestScore = -Infinity;
  // Zero marks uncertain boundaries, not an object. Retain the entire selected
  // entity, including pixels outside the rectangle or lasso.
  for (const label of new Set(pixels)) {
    if (!label) continue;
    const mask = Uint8Array.from(pixels, value => value === label ? 255 : 0);
    const score = segmentMaskScore(mask, selected, width, height, selection);
    if (score > bestScore) { best = mask; bestScore = score; }
  }
  if (!best) throw new AppError("SEGMENTATION_FAILED", 422);
  return sharp(best, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export async function segmentVolcImage(channel, image, selection, signal, selectionBytes) {
  const { width, height } = await sharp(image).metadata();
  return selectEntityMask(await entityLabels(channel, image, signal), selection, width, height, selectionBytes);
}

export async function entityLayers(image, labels, signal) {
  const { data: source, info: { width, height } } = await sharp(image, { limitInputPixels: 40000000 }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = await decodeEntityLabels(labels, width, height);
  const counts = new Map();
  for (let i = 0; i < pixels.length; i++) {
    if (source[i * 4 + 3]) counts.set(pixels[i], (counts.get(pixels[i]) || 0) + 1);
  }
  const entities = [...counts.keys()].filter(label => label !== 0).sort((a, b) => counts.get(b) - counts.get(a) || a - b);
  // Preserve unassigned boundary pixels in a separate bottom layer. Every
  // visible source pixel belongs to exactly one layer, so stacking is lossless.
  const layerIds = [...(counts.has(0) ? [0] : []), ...entities];
  if (!entities.length || layerIds.length < 2) throw new AppError("NO_SEPARABLE_OBJECTS", 422);
  if (entities.length > 20) throw new AppError("INVALID_LAYER_RESULT", 502);
  const images = [];
  for (const label of layerIds) {
    signal?.throwIfAborted();
    const rgba = Buffer.alloc(source.length);
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] !== label || !source[i * 4 + 3]) continue;
      source.copy(rgba, i * 4, i * 4, i * 4 + 4);
    }
    images.push(await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer());
  }
  return images;
}

export async function splitVolcImage(channel, image, signal) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
  return entityLayers(image, await entityLabels(channel, image, requestSignal), requestSignal);
}
