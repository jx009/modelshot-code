#!/usr/bin/env node
/**
 * 提权脚本 — 把指定邮箱的用户提为管理员（默认 root，一人公司直接给最高级）
 * 用法：node scripts/make-admin.js you@example.com [--role=root|admin|agent]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

// 脚本独立运行：手动加载 .env（Next dev 之外没有自动 env）
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// 与 src/lib/prisma.js 相同构造（Prisma 7 driver adapter 模式）
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const [email, ...rest] = process.argv.slice(2);
if (!email) {
  console.log("用法: node scripts/make-admin.js you@example.com [--role=root|admin|agent]");
  process.exit(1);
}
const roleArg = rest.find(a => a.startsWith("--role="));
const role = roleArg ? roleArg.split("=")[1] : "root";
if (!["agent", "admin", "root"].includes(role)) {
  console.log(`✗ 非法角色: ${role}（可选 agent | admin | root）`);
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
if (!user) {
  console.log(`✗ 用户不存在: ${email}（请先注册再提权）`);
  process.exit(1);
}

await prisma.user.update({
  where: { id: user.id },
  data: { role },
});
console.log(`✓ ${email} → role=${role}（原 ${user.role}）`);
await prisma.$disconnect();
