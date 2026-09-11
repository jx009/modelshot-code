import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * 开发热更新复用连接池；重新生成 Prisma Client 后需重启开发服务器。
 */
export const prisma = globalThis.modelshotPrisma || new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 }),
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") globalThis.modelshotPrisma = prisma;
