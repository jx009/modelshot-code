import sharp from "sharp";
import path from "path";
import { readFile, writeFile } from "fs/promises";

/**
 * 合规元数据注入 — 双层：
 * 1. EXIF/IPTC（sharp，始终注入）— 基础机器可读声明
 * 2. C2PA Content Credentials（c2pa-node，可配置）— 行业标准内容凭证
 *
 * C2PA 签名策略：
 * - C2PA_CERT_PATH + C2PA_KEY_PATH 配置 → 生产证书签名
 * - 未配置证书 && 非生产环境 → 自动使用 c2pa-node 测试证书（仅供开发验证，
 *   测试证书在 Content Credentials Verify 中显示为未信任，生产必须换真证书）
 * - C2PA_DISABLED=1 → 完全跳过
 *
 * @param {string} localPath - 本地文件路径（如 /uploads/xxx.png 相对 public）
 * @param {Object} meta - { provider, prompt }
 * @returns {Promise<string>} 注入后的文件路径（原地覆写）
 */
export async function injectMetadata(localPath, meta = {}) {
  // 支持两种路径：web 路径（/uploads/xxx.png → public/uploads/xxx.png）和绝对路径
  const filepath = path.isAbsolute(localPath) && localPath.startsWith("/tmp")
    ? localPath
    : path.isAbsolute(localPath)
      ? localPath
      : localPath.startsWith("/")
        ? path.join(process.cwd(), "public", localPath.replace(/^\//, ""))
        : path.join(process.cwd(), localPath);

  // ── 第一层：EXIF/IPTC ──
  const image = sharp(filepath);
  const withMeta = image.withMetadata({
    exif: {
      IFD0: {
        Software: "ModelShot AI",
        ImageDescription: "AI-generated fashion product image",
        UserComment: JSON.stringify({
          ai_generated: true,
          provider: meta.provider || null,
          timestamp: new Date().toISOString(),
          disclosure: "This image was generated using artificial intelligence.",
        }),
      },
    },
  });
  const exifBuffer = await withMeta.png().toBuffer();
  await writeFile(filepath, exifBuffer);

  // ── 第二层：C2PA 内容凭证 ──
  try {
    await signC2PA(filepath, meta);
  } catch (error) {
    // C2PA 失败不阻塞交付（EXIF 已兜底）
    console.error("[C2PA] sign failed (non-blocking):", error.message);
  }

  return localPath;
}

// C2PA 实例缓存（signer 初始化较重）
let c2paInstance = null;
let c2paInitPromise = null;

async function getC2pa() {
  if (process.env.C2PA_DISABLED === "1") return null;
  if (c2paInstance) return c2paInstance;
  if (c2paInitPromise) return c2paInitPromise;

  c2paInitPromise = (async () => {
    const { createC2pa, createTestSigner } = await import("c2pa-node");

    let signer;
    if (process.env.C2PA_CERT_PATH && process.env.C2PA_KEY_PATH) {
      const { LocalSigner } = await import("c2pa-node/dist/js-src/lib/signer.js").catch(() => ({}));
      // 生产证书路径
      const [certificate, privateKey] = await Promise.all([
        readFile(process.env.C2PA_CERT_PATH),
        readFile(process.env.C2PA_KEY_PATH),
      ]);
      signer = {
        type: "local",
        certificate,
        privateKey,
      };
      void LocalSigner;
    } else if (process.env.NODE_ENV !== "production") {
      // 开发环境：c2pa-node 自带的测试证书
      signer = await createTestSigner();
    } else {
      // 生产且未配置证书 → 不签（EXIF 兜底）
      console.warn("[C2PA] production without C2PA_CERT_PATH/C2PA_KEY_PATH, skipping C2PA signing");
      return null;
    }

    c2paInstance = createC2pa({ signer });
    return c2paInstance;
  })();

  const result = await c2paInitPromise;
  if (!result) c2paInitPromise = null; // 允许后续重试（如配置补齐）
  return result;
}

/**
 * C2PA 签名（原地覆写）
 * manifest 声明：AI 生成 + digitalSourceType=trainedAlgorithmicMedia（C2PA 标准 AI 内容声明）
 */
async function signC2PA(filepath, meta = {}) {
  const c2pa = await getC2pa();
  if (!c2pa) return;

  const { ManifestBuilder } = await import("c2pa-node");

  const buffer = await readFile(filepath);
  const manifest = new ManifestBuilder({
    claim_generator: `ModelShot AI/0.1 (${meta.provider || "ai"})`,
    format: "image/png",
    title: "AI-Generated Fashion Model Photo",
    vendor: "modelshot",
    assertions: [
      {
        label: "c2pa.actions",
        data: {
          actions: [
            {
              action: "c2pa.created",
              softwareAgent: "ModelShot AI",
              when: new Date().toISOString(),
              digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
            },
          ],
        },
      },
      {
        label: "c2pa.ai.disclosure",
        data: {
          statement: "This image was generated using artificial intelligence by ModelShot AI.",
          aiGenerated: true,
          provider: meta.provider || null,
        },
      },
    ],
  });

  const { signedAsset } = await c2pa.sign({
    manifest,
    asset: { buffer, mimeType: "image/png" },
  });

  await writeFile(filepath, signedAsset.buffer);
}
