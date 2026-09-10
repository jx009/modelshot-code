/**
 * 模型适配器统一接口
 * 所有 AI 模型提供商必须实现这个接口
 *
 * 参考 OpenTryOn 的 Adapter 模式：每个 provider 封装为独立类，
 * 遵循统一 method signature，由 runner.js 统一调度
 */
export class BaseAdapter {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  /**
   * 核心方法：服装平铺图 → 模特上身图
   * @param {Object} params
   * @param {Buffer|string} params.garmentImage  - 服装平铺图（URL 或 base64）
   * @param {string} params.modelRef      - 模特参考图（URL 或 base64）
   * @param {string} params.sceneRef      - 场景参考图（可选）
   * @param {string} params.prompt        - 组装好的 prompt
   * @param {string} params.size          - "1024x1536" | "1536x1024" | "1024x1024"
   * @param {string} params.quality       - "low" | "medium" | "high"
   * @returns {Promise<{imageBase64?: string, imageUrl?: string, costUsd: number, raw: any}>}
   */
  async generateTryOn(params) {
    throw new Error(`${this.name}: generateTryOn not implemented`);
  }

  /** 局部精修（Inpainting） */
  async inpaint(params) {
    throw new Error(`${this.name}: inpaint not implemented`);
  }

  /** 健康检查 */
  async healthCheck() {
    return { ok: true, provider: this.name };
  }
}

/**
 * 通用辅助：本地路径读取（/uploads/xx.png → public 下的文件）
 */
async function readLocalPath(source) {
  const { readFile } = await import("fs/promises");
  const path = await import("path");
  const filepath = path.join(process.cwd(), "public", source.replace(/^\//, ""));
  const buf = await readFile(filepath);
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return { buf, mime };
}

/**
 * 通用辅助：把 URL / 本地路径 / base64 / Buffer 转成 File 对象（OpenAI SDK 需要）
 */
export async function toFileObject(source, filename = "image.png") {
  if (typeof File !== "undefined" && source instanceof File) return source;
  if (Buffer.isBuffer(source)) {
    return new File([source], filename, { type: "image/png" });
  }
  if (typeof source === "string") {
    // data URI 或纯 base64
    if (source.startsWith("data:")) {
      const [meta, b64] = source.split(",");
      const mime = meta.slice(5).split(";")[0] || "image/png";
      return new File([Buffer.from(b64, "base64")], filename, { type: mime });
    }
    if (source.startsWith("http")) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
      const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      return new File([buf], `${filename}.${ext}`, { type: mime });
    }
    // 本地路径（/uploads/xx.png）
    if (source.startsWith("/")) {
      const { buf, mime } = await readLocalPath(source);
      return new File([buf], filename, { type: mime });
    }
    // 纯 base64 字符串
    return new File([Buffer.from(source, "base64")], filename, { type: "image/png" });
  }
  throw new Error(`Unsupported image source type: ${typeof source}`);
}

/**
 * 通用辅助：把 URL / base64 字符串转成 { mimeType, data(base64) }（Gemini 需要）
 */
export async function toInlineData(source) {
  if (typeof source !== "string") throw new Error(`Unsupported image source type: ${typeof source}`);
  if (source.startsWith("data:")) {
    const [meta, b64] = source.split(",");
    const mimeType = meta.slice(5).split(";")[0] || "image/png";
    return { mimeType, data: b64 };
  }
  if (source.startsWith("http")) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/png";
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { mimeType, data };
  }
  // 本地路径（/uploads/xx.png）
  if (source.startsWith("/")) {
    const { buf, mime } = await readLocalPath(source);
    return { mimeType: mime, data: buf.toString("base64") };
  }
  return { mimeType: "image/png", data: source };
}
