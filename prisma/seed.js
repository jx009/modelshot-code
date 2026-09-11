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
import { existsSync } from "node:fs";

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

  // ===== 预设模特（8 个基础款，占位参考图，正式运营需替换真人模特图）=====
  const models = [
    { name: "亚洲女模-01", nameEn: "Asian Female 01", gender: "female", ethnicity: "asian", bodyType: "standard" },
    { name: "亚洲女模-02", nameEn: "Asian Female 02", gender: "female", ethnicity: "asian", bodyType: "slim" },
    { name: "亚洲男模-01", nameEn: "Asian Male 01", gender: "male", ethnicity: "asian", bodyType: "standard" },
    { name: "欧美女模-01", nameEn: "Caucasian Female 01", gender: "female", ethnicity: "caucasian", bodyType: "standard" },
    { name: "欧美男模-01", nameEn: "Caucasian Male 01", gender: "male", ethnicity: "caucasian", bodyType: "standard" },
    { name: "非裔女模-01", nameEn: "African Female 01", gender: "female", ethnicity: "african", bodyType: "standard" },
    { name: "拉丁裔女模-01", nameEn: "Latin Female 01", gender: "female", ethnicity: "latin", bodyType: "standard" },
    { name: "大码女模-01", nameEn: "Plus-size Female 01", gender: "female", ethnicity: "asian", bodyType: "plus" },
  ];
  let i = 0;
  for (const m of models) {
    const referenceImage = `/presets/models/model-${String(i + 1).padStart(2, "0")}.png`;
    const existing = await prisma.modelPreset.findFirst({ where: { name: m.name } });
    if (!existing) {
      await prisma.modelPreset.create({
        data: { ...m, referenceImage, sortOrder: i, isActive: existsSync(`public${referenceImage}`) },
      });
    }
    i++;
  }

  // ===== 预设场景 =====
  const scenes = [
    { name: "纯白背景", nameEn: "Pure White", category: "white", promptSnippet: "Clean white studio background, professional even lighting." },
    { name: "灰色影棚", nameEn: "Gray Studio", category: "studio", promptSnippet: "Professional gray studio backdrop, three-point lighting." },
    { name: "街拍-城市", nameEn: "Urban Street", category: "street", promptSnippet: "Urban street setting, natural daylight, modern city background." },
    { name: "室内-极简", nameEn: "Minimalist Indoor", category: "indoor", promptSnippet: "Minimalist modern interior, warm ambient lighting." },
    { name: "户外-公园", nameEn: "Outdoor Park", category: "outdoor", promptSnippet: "Park setting with trees, natural golden hour lighting." },
    { name: "海滩", nameEn: "Beach", category: "outdoor", promptSnippet: "Sandy beach setting, bright sunlight, blue sky and ocean." },
  ];
  let j = 0;
  for (const s of scenes) {
    const existing = await prisma.scenePreset.findFirst({ where: { name: s.name } });
    if (!existing) {
      await prisma.scenePreset.create({
        data: { ...s, sortOrder: j },
      });
    }
    j++;
  }

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

  console.log("✅ Seed data created (providers: 3, models: 8, scenes: 6, promptTemplates: 5)");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
