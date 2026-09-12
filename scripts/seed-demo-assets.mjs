import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { createImage } from "../src/lib/domain/assets/service.js";
import { objectStorage } from "../src/lib/infra/storage/s3.js";
import {
  demoAssetId,
  loadDemoManifest,
  parseDemoSeedArguments,
  readBundledGarment,
  seedGlobalPresets,
  verifyBundledGarments,
  verifyPresetFiles,
} from "./demo-assets-lib.mjs";

async function main() {
  const { userEmail, verifyOnly } = parseDemoSeedArguments(process.argv.slice(2));
  const manifest = await loadDemoManifest();
  const presets = await verifyPresetFiles(manifest);
  const garments = await verifyBundledGarments(manifest);
  console.log(`Verified ${presets.length + garments.size} bundled demo assets.`);
  if (verifyOnly) return;

  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true, email: true } });
  if (!user) throw new Error(`No registered account found for ${userEmail}`);
  const storage = objectStorage();
  await storage.health();
  await seedGlobalPresets(prisma, manifest);

  let created = 0;
  let existing = 0;
  for (const garment of manifest.garments) {
    const id = demoAssetId(user.id, garment.id);
    const current = await prisma.asset.findUnique({ where: { id } });
    if (current) {
      if (current.userId !== user.id || current.status !== "active") throw new Error(`Conflicting demo asset: ${id}`);
      existing++;
      continue;
    }
    const { bytes, contentType } = garments.get(garment.id) || await readBundledGarment(garment);
    await createImage(user.id, bytes, { id, kind: "upload", declaredType: contentType }, prisma, storage);
    created++;
    console.log(`Added garment: ${garment.name} (${garment.source})`);
  }
  console.log(`Demo assets ready for ${user.email}: ${created} created, ${existing} already present.`);
}

main()
  .catch(error => {
    console.error(`Demo seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
