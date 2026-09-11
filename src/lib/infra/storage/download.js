import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { AppError } from "../../http.js";
import { IMAGE_LIMITS } from "../../domain/assets/service.js";

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}

export async function downloadProviderImage(value, resolver = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new AppError("UNSAFE_IMAGE_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new AppError("UNSAFE_IMAGE_URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolver(hostname, { all: true });
  if (!addresses.length || addresses.some(record => !isPublicAddress(record.address))) throw new AppError("UNSAFE_IMAGE_URL");
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      signal: AbortSignal.timeout(20_000),
      // Pin the validated address for this connection, eliminating DNS rebinding.
      lookup: (_host, options, callback) => options.all ? callback(null, [target]) : callback(null, target.address, target.family),
    }, response => {
      if (response.statusCode !== 200 || Number(response.headers["content-length"]) > IMAGE_LIMITS.bytes) {
        response.destroy();
        reject(new AppError("IMAGE_DOWNLOAD_REJECTED"));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on("data", chunk => {
        size += chunk.length;
        if (size > IMAGE_LIMITS.bytes) response.destroy(new AppError("INVALID_IMAGE_SIZE", 413));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}
