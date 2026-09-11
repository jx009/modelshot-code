import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getTestEnvironment } from "./environment.mjs";

export async function resetBrowserData(db) {
  getTestEnvironment();
  const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map(row => `"${row.tablename.replaceAll('"', '""')}"`).join(", ")} CASCADE`);
  const storage = new S3Client(getTestEnvironment().storage);
  try {
    let page;
    do {
      page = await storage.send(new ListObjectsV2Command({ Bucket: "modelshot-e2e" }));
      if (page.Contents?.length) await storage.send(new DeleteObjectsCommand({ Bucket: "modelshot-e2e", Delete: { Objects: page.Contents.map(row => ({ Key: row.Key })) } }));
    } while (page.IsTruncated);
  } catch (error) { if (error.name !== "NoSuchBucket") throw error; }
  finally { storage.destroy(); }
}
