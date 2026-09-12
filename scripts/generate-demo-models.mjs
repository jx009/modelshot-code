import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outputDir = path.join(root, "public", "presets", "models");
const manifestFile = path.join(root, "scripts", "demo-assets.manifest.json");
const endpoint = process.env.IMAGE_API_URL || "https://api.letaicode.cn/codex/images/generations";
const apiKey = process.env.LETAICODE_API_KEY;
const model = process.env.IMAGE_MODEL || "gpt-image-2";

if (!apiKey) throw new Error("Set LETAICODE_API_KEY before generating demo models.");

const prompts = [
  "A premium e-commerce fashion catalog photograph of a fictional adult East Asian woman, average build, shoulder-length dark hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white tank top and black straight-leg trousers, clean light gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult East Asian woman, slim build, long dark hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white tank top and black straight-leg trousers, clean warm gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult East Asian man, average build, short black hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white crew-neck t-shirt and dark trousers, clean pale gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult white woman, average build, shoulder-length light brown hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted ivory tank top and dark trousers, clean light gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult white man, broad average build, short brown hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white t-shirt and navy trousers, clean neutral gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult Black woman, average build, natural textured shoulder-length hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white tank top and charcoal trousers, clean light gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult Latina woman, average build, long dark wavy hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white tank top and black trousers, clean neutral gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult East Asian woman, clearly plus-size curvy build, long dark hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white tank top and dark trousers, clean pale gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult East Asian man, slim build, short black hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white crew-neck t-shirt and black straight-leg trousers, clean light gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult East Asian man, clearly plus-size broad build, short black hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white crew-neck t-shirt and charcoal trousers, clean neutral gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult white woman, slim build, long auburn hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted ivory tank top and black straight-leg trousers, clean warm gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult white woman, clearly plus-size curvy build, shoulder-length blonde hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white tank top and navy trousers, clean light gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult Black man, athletic average build, close-cropped hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white crew-neck t-shirt and dark trousers, clean neutral gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult Black woman, clearly plus-size curvy build, natural textured hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted ivory tank top and charcoal trousers, clean pale gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional adult Latino man, average build, short dark wavy hair, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted white crew-neck t-shirt and black trousers, clean warm gray seamless studio background, soft even diffused lighting, realistic skin texture, editorial fashion photography, centered composition, no logos, no text, no watermark.",
  "A premium e-commerce fashion catalog photograph of a fictional mature East Asian woman in her early fifties, average build, shoulder-length dark hair with subtle gray strands, full body from head to shoes, standing naturally and facing camera, relaxed arms, wearing a simple fitted ivory top and dark straight-leg trousers, clean neutral gray seamless studio background, soft even diffused lighting, realistic skin texture and natural age details, editorial fashion photography, centered composition, no logos, no text, no watermark.",
];

const requestedIndices = new Set(
  (process.env.DEMO_MODEL_INDICES || prompts.map((_, index) => index + 1).join(","))
    .split(",")
    .map(value => Number(value.trim())),
);
if ([...requestedIndices].some(index => !Number.isInteger(index) || index < 1 || index > prompts.length)) {
  throw new Error(`DEMO_MODEL_INDICES must contain comma-separated model numbers from 1 to ${prompts.length}.`);
}

async function requestImage(prompt, index) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ model, prompt, size: "1024x1024", quality: "medium" }),
        signal: AbortSignal.timeout(180_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(`Image API request ${index} failed (${response.status}): ${payload?.error?.message || "unknown error"}`);
      const item = payload?.data?.[0];
      if (!item) throw new Error(`Image API request ${index} returned no image`);
      if (item.b64_json) return Buffer.from(item.b64_json, "base64");
      if (item.url) {
        const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
        if (!imageResponse.ok) throw new Error(`Generated image download failed (${imageResponse.status})`);
        return Buffer.from(await imageResponse.arrayBuffer());
      }
      throw new Error(`Image API request ${index} returned neither b64_json nor url`);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

await mkdir(outputDir, { recursive: true });
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
if (manifest.models.length !== prompts.length) {
  throw new Error(`Manifest has ${manifest.models.length} models but the generator defines ${prompts.length} prompts.`);
}
for (const [index, prompt] of prompts.entries()) {
  if (!requestedIndices.has(index + 1)) continue;
  const file = path.join(outputDir, `model-${String(index + 1).padStart(2, "0")}.png`);
  const source = await requestImage(prompt, index + 1);
  await sharp(source, { failOn: "warning", limitInputPixels: 40_000_000 })
    .resize(1024, 1024, { fit: "cover", position: "centre" })
    .png()
    .toFile(file);
  const bytes = await readFile(file);
  const metadata = await sharp(bytes).metadata();
  manifest.models[index].sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`Generated ${path.relative(root, file)} (${metadata.width}x${metadata.height})`);
}
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Updated ${path.relative(root, manifestFile)}`);
