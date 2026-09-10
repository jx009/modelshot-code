import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../../../lib/auth";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 通用文件上传 — 落盘到 public/uploads，DB 只存 URL 路径
 * （修复：此前返回 base64 data URL 直接进 DB，导致库膨胀 + 批量请求体超限）
 */
export async function POST(req) {
  try {
    const session = await getServerSession(await buildAuthOptions());
    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const data = await req.formData();
    const file = data.get("file");

    if (!file) {
      return new NextResponse("No file uploaded", { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return new NextResponse("File too large (max 10MB)", { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.mkdir(UPLOAD_ROOT, { recursive: true });

    // 随机文件名（不含用户可控内容），扩展名从 mimetype 映射
    const mimeToExt = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/webp": "webp",
    };
    const ext = mimeToExt[file.type] || "png";
    const filename = `${crypto.randomUUID()}.${ext}`;

    await fs.writeFile(path.join(UPLOAD_ROOT, filename), bytes);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    console.error("[UPLOAD]", error);
    return new NextResponse("Upload failed", { status: 500 });
  }
}
