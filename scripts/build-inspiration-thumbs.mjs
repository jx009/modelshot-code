// 为首页作品墙、场景卡等装饰位生成小尺寸缩略图，输出到 public/inspiration/thumbs/。
// 这些文件随镜像一起发布到香港静态目录，避免首屏加载 1–2K 原图或回源美国走图片优化接口。
// 用法：node scripts/build-inspiration-thumbs.mjs   （已存在且比源图新的文件会跳过）
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const source = "public/inspiration/generated";
const target = "public/inspiration/thumbs";
const WIDTH = 480;

await mkdir(target, { recursive: true });
let written = 0, skipped = 0, bytes = 0;
for (const name of (await readdir(source)).filter(file => file.endsWith(".webp")).sort()) {
  const from = join(source, name), to = join(target, name.replace(/\.webp$/, `-${WIDTH}.webp`));
  const existing = await stat(to).catch(() => null);
  if (existing && existing.mtimeMs >= (await stat(from)).mtimeMs) { skipped++; bytes += existing.size; continue; }
  const info = await sharp(from).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 72, effort: 5 }).toFile(to);
  written++; bytes += info.size;
}
console.log(`thumbs: ${written} written, ${skipped} up to date, ${(bytes / 1024 / 1024).toFixed(2)} MiB total`);
