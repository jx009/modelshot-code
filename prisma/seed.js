/**
 * 种子数据：模型提供商 + 预设模特 + 预设场景
 * 幂等：重复跑不会重复插入
 *
 * 运行：node prisma/seed.js
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadDemoManifest, seedGlobalPresets, verifyPresetFiles } from "../scripts/demo-assets-lib.mjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // ===== 模型提供商（按 name upsert）=====
  const providers = [
    { name: "openai", displayName: "GPT Image 2", isActive: true, isDefault: true, priority: 1, costPerImage: 0.08 },
    { name: "gemini", displayName: "Gemini Flash Image", isActive: true, isDefault: false, priority: 2, costPerImage: 0.04 },
    { name: "fashn", displayName: "FASHN.ai", isActive: false, isDefault: false, priority: 3, costPerImage: 0.05 },
  ];
  for (const p of providers) {
    await prisma.modelProvider.upsert({
      where: { name: p.name },
      update: { displayName: p.displayName, priority: p.priority, costPerImage: p.costPerImage },
      create: p,
    });
  }

  // ===== 可用的合成模特与开放许可场景（按 name 幂等更新）=====
  const demoManifest = await loadDemoManifest();
  await verifyPresetFiles(demoManifest);
  await seedGlobalPresets(prisma, demoManifest);

  // ===== Prompt 模板（同步 prompt-engine.js 硬编码版，Admin 可在线编辑实时生效）=====
  const promptTemplates = [
    {
      name: "上衣模板", category: "top",
      template: "A professional fashion photo of a {{gender}} model wearing the exact garment shown in the reference image. The garment is a {{garmentDesc}}. {{sceneDesc}} The model has {{modelDesc}}. The garment must be faithfully reproduced: accurate color, fabric texture, pattern/logo placement, and fit. Photo-realistic, e-commerce quality, sharp focus, even lighting.",
    },
    {
      name: "下装模板", category: "bottom",
      template: "A professional fashion photo of a {{gender}} model wearing the exact pants/skirt shown in the reference image. {{sceneDesc}} The model has {{modelDesc}}. Accurate reproduction of: fabric drape, waistline, length, and any design details. Photo-realistic, e-commerce quality.",
    },
    {
      name: "连衣裙模板", category: "dress",
      template: "A professional fashion photo of a {{gender}} model wearing the exact dress shown in the reference image. {{sceneDesc}} The model has {{modelDesc}}. Full-length view showing accurate silhouette, fabric flow, neckline, and pattern. Photo-realistic, e-commerce quality.",
    },
    {
      name: "外套模板", category: "outerwear",
      template: "A professional fashion photo of a {{gender}} model wearing the exact coat/jacket shown in the reference image over a simple top. {{sceneDesc}} The model has {{modelDesc}}. Show accurate collar, closure, sleeve length, and material texture. Photo-realistic.",
    },
    {
      name: "泳装模板", category: "swimwear",
      template: "A professional fashion photo of a {{gender}} model wearing the exact swimwear shown in the reference image. {{sceneDesc}} The model has {{modelDesc}}. Accurate reproduction of cut, color, and pattern. Photo-realistic, tasteful e-commerce photography.",
    },
  ];
  for (const t of promptTemplates) {
    const existing = await prisma.promptTemplate.findFirst({ where: { category: t.category } });
    if (!existing) {
      await prisma.promptTemplate.create({ data: t });
    }
  }

  console.log("✅ Seed data created (providers: 3, models: 16, scenes: 6, promptTemplates: 5)");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
