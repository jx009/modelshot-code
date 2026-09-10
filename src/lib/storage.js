/**
 * 本地图片存储 — MVP 阶段写 public/uploads（Next.js 自动静态服务）
 * 生产阶段切换 S3/R2/OSS 时只需改这一个文件
 */
import fs from "fs/promises";
import path from "path";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

export async function saveImage(source, id) {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });

  const filename = `${id}.png`;
  const filepath = path.join(UPLOAD_ROOT, filename);

  if (typeof source === "string" && source.startsWith("data:")) {
    // data URI → 写文件
    const b64 = source.split(",")[1];
    await fs.writeFile(filepath, Buffer.from(b64, "base64"));
  } else if (typeof source === "string" && source.startsWith("http")) {
    // 远程 URL → 下载写文件
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    await fs.writeFile(filepath, Buffer.from(await res.arrayBuffer()));
  } else if (typeof source === "string") {
    // 纯 base64
    await fs.writeFile(filepath, Buffer.from(source, "base64"));
  } else {
    throw new Error(`Unsupported image source: ${typeof source}`);
  }

  return `/uploads/${filename}`;
}
