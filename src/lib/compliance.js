import sharp from "sharp";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

export async function injectMetadataBuffer(buffer, meta = {}) {
  const disclosed = await sharp(buffer).withExif({
    IFD0: { Software: "ModelShot AI", ImageDescription: "AI-generated commerce product image" },
  }).png().toBuffer();
  if (process.env.C2PA_ENABLED !== "1" || process.env.C2PA_DISABLED === "1") return { buffer: disclosed, status: "unsigned" };
  if (!process.env.C2PA_CERT_PATH || !process.env.C2PA_KEY_PATH) throw new Error("C2PA signing requires configured credentials");
  const { createC2pa, ManifestBuilder } = await import("c2pa-node");
  const [certificate, privateKey] = await Promise.all([readFile(process.env.C2PA_CERT_PATH), readFile(process.env.C2PA_KEY_PATH)]);
  const c2pa = createC2pa({ signer: { type: "local", certificate, privateKey } });
  const manifest = new ManifestBuilder({
    claim_generator: `ModelShot/1 (${meta.provider || "ai"})`, format: "image/png", title: "AI-generated commerce image", vendor: "modelshot",
    assertions: [{ label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", softwareAgent: "ModelShot", when: new Date().toISOString(), digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" }] } }],
  });
  const { signedAsset } = await c2pa.sign({ manifest, asset: { buffer: disclosed, mimeType: "image/png" } });
  return { buffer: signedAsset.buffer, status: "signed" };
}

// Retained only for local metadata diagnostics; generation uses buffers throughout.
export async function injectMetadata(localPath, meta = {}) {
  if (typeof localPath !== "string" || !/^\/uploads\/[a-zA-Z0-9_-]+\.png$/.test(localPath)) throw new Error("Invalid generated image path");
  const filepath = path.join(process.cwd(), "public/uploads", localPath.slice("/uploads/".length));
  const result = await injectMetadataBuffer(await readFile(filepath), meta);
  await writeFile(filepath, result.buffer);
  return localPath;
}
