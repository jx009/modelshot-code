import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

/**
 * Prisma client 单例
 * 注意：故意不用 globalThis 缓存 —— Next.js 16 dev mode（Turbopack）的模块缓存层
 * 会持有旧 PrismaClient 实例（schema 变更后不更新），缓存是 schema 漂移的根因。
 * 每次请求新建 client 代价大但能 100% 保证 schema 一致 —— 由 Prisma 自身的连接池复用 DB 连接。
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});
