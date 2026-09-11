import { prisma } from "./prisma.js";

/**
 * PromptTemplate DB 存取 — Admin 在线编辑实时生效
 * 独立模块 + 动态 import，避免 prompt-engine（纯函数）顶层依赖 prisma
 */

// 短 TTL 缓存，减少每次生图的 DB 查询
const CACHE_TTL_MS = 30_000;
const cache = new Map(); // category → { template, cachedAt }

export async function getPromptTemplate(category) {
  const hit = cache.get(category);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
    return hit.template;
  }

  const row = await prisma.promptTemplate.findFirst({
    where: { category, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { template: true },
  });

  cache.set(category, { template: row?.template || null, cachedAt: Date.now() });
  return row?.template || null;
}

/** Admin 改模板后清缓存（立即生效） */
export function invalidatePromptCache() {
  cache.clear();
}
