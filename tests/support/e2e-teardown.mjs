import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getTestEnvironment } from "./environment.mjs";
import { resetBrowserData } from "./reset-browser-data.mjs";

export default async function teardown() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: getTestEnvironment().databaseUrl }) });
  try { await resetBrowserData(prisma); }
  finally { await prisma.$disconnect(); }
}
