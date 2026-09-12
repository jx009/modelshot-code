import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set(["images.metmuseum.org"]);
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function parseDemoSeedArguments(argv) {
  let userEmail = "";
  let verifyOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--verify-only") verifyOnly = true;
    else if (argument.startsWith("--user-email=")) userEmail = argument.slice(13);
    else if (argument === "--user-email") userEmail = argv[++index] || "";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  userEmail = userEmail.trim().toLowerCase();
  if (!verifyOnly && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    throw new Error("Pass a registered account with --user-email=user@example.com");
  }
  return { userEmail, verifyOnly };
}

export async function loadDemoManifest(file = path.join(process.cwd(), "scripts", "demo-assets.manifest.json")) {
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.models) || !Array.isArray(manifest.scenes) || !Array.isArray(manifest.garments)) {
    throw new Error("Unsupported demo asset manifest");
  }
  return manifest;
}

export async function verifyPresetFiles(manifest, root = process.cwd()) {
  const entries = [...manifest.models, ...manifest.scenes];
  const results = [];
  for (const entry of entries) {
    if (!/^\/presets\/[a-zA-Z0-9/_-]+\.(png|jpg|jpeg|webp)$/.test(entry.referenceImage)) throw new Error(`Invalid preset path: ${entry.referenceImage}`);
    const file = path.join(root, "public", entry.referenceImage);
    const bytes = await readFile(file);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== entry.sha256) throw new Error(`Preset checksum mismatch: ${entry.referenceImage}`);
    results.push({ referenceImage: entry.referenceImage, bytes: bytes.length, checksum });
  }
  return results;
}

function checkedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new Error(`Download host is not allowed: ${url.hostname}`);
  }
  return url;
}

export async function downloadVerifiedGarment(entry, fetchImpl = fetch) {
  let url = checkedUrl(entry.downloadUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: { accept: "image/jpeg,image/png,image/webp", "user-agent": "ModelShot demo asset seeder/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error(`Too many redirects for ${entry.id}`);
      url = checkedUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`Download failed for ${entry.id}: HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) throw new Error(`Unexpected content type for ${entry.id}: ${contentType || "missing"}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error(`Download is too large for ${entry.id}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw new Error(`Invalid download size for ${entry.id}`);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== entry.sha256) throw new Error(`Downloaded checksum mismatch for ${entry.id}`);
    return { bytes, contentType, checksum };
  }
  throw new Error(`Could not download ${entry.id}`);
}

export async function readBundledGarment(entry, root = process.cwd()) {
  if (!/^demo-assets\/garments\/[a-zA-Z0-9_-]+\.jpg$/.test(entry.bundledPath)) throw new Error(`Invalid bundled garment path: ${entry.bundledPath}`);
  const bytes = await readFile(path.join(root, entry.bundledPath));
  if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) throw new Error(`Invalid bundled garment size for ${entry.id}`);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== entry.sha256) throw new Error(`Bundled garment checksum mismatch for ${entry.id}`);
  return { bytes, contentType: "image/jpeg", checksum };
}

export async function verifyBundledGarments(manifest, root = process.cwd()) {
  const garments = new Map();
  for (const entry of manifest.garments) garments.set(entry.id, await readBundledGarment(entry, root));
  return garments;
}

export function demoAssetId(userId, sourceId) {
  return `demo_${createHash("sha256").update(`${userId}:${sourceId}`).digest("hex").slice(0, 32)}`;
}

async function syncPreset(db, model, data) {
  const existing = await model.findFirst({ where: { name: data.name } });
  if (existing) return model.update({ where: { id: existing.id }, data });
  return model.create({ data });
}

export async function seedGlobalPresets(db, manifest) {
  for (const [sortOrder, { sha256: _sha256, ...model }] of manifest.models.entries()) {
    await syncPreset(db, db.modelPreset, { ...model, sortOrder, isActive: true });
  }
  for (const [sortOrder, { sha256: _sha256, ...scene }] of manifest.scenes.entries()) {
    await syncPreset(db, db.scenePreset, { ...scene, sortOrder, isActive: true });
  }
}
