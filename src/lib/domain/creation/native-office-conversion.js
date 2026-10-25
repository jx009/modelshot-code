import { createHash } from "node:crypto";
import { AppError } from "../../http.js";
import { prisma } from "../../prisma.js";
import { objectStorage } from "../../infra/storage/s3.js";
import { ownedArtifact } from "./artifacts.js";
import { readDocumentArtifact } from "./document-artifacts.js";
import { readSheetArtifact } from "./sheet-artifacts.js";
import { createNativeOfficeArtifact } from "./native-office-artifacts.js";
import { toNativeDocumentArtifact } from "../../creation/native-document-adapter.js";
import { toNativeSheetArtifact } from "../../creation/native-sheet-adapter.js";
import { assertNativeOfficeRuntimeContent } from "../../creation/client/native-office-policy.js";
import { convertNativeOfficeArtifactSchema } from "../../creation/contracts/native-office.js";
import { getCreationEnv, assertCreationAccess } from "../../creation/access.js";

export const nativeOfficeConversionEnabled = (env = process.env) => env.CREATION_WORKSPACE_ENABLED === "true" && env.CREATION_NATIVE_OFFICE_ENABLED === "true";

// Convert a fixed, owned source revision into a separate artifact. The source
// remains in its existing AI/export workflow; conversion is not a format flip.
export async function convertNativeOfficeArtifact(userId, id, input, { db = prisma, store = objectStorage() } = {}) {
  const { baseRevision, saveKey } = convertNativeOfficeArtifactSchema.parse(input);
  const metadata = await ownedArtifact(userId, id, db);
  const admission = async (tx = db) => {
    const env = await getCreationEnv(userId, { db: tx });
    assertCreationAccess(env, { kind: metadata.kind });
    if (!nativeOfficeConversionEnabled(env)) throw new AppError("NATIVE_OFFICE_NOT_ENABLED", 503);
  };
  if (!["document", "sheet"].includes(metadata.kind)) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
  const read = metadata.kind === "document" ? readDocumentArtifact : readSheetArtifact;
  const source = await read(userId, id, baseRevision, { db, store });
  const digest = createHash("sha256").update(JSON.stringify([id, saveKey])).digest("hex"), key = `native-copy-${digest}`;
  const adapt = metadata.kind === "document" ? toNativeDocumentArtifact : toNativeSheetArtifact;
  let content;
  try {
    content = adapt(source.content, `native_${digest.slice(0, 32)}`);
    content.title = `${content.title.slice(0, 140)}${content.snapshot.locale === "enUS" ? " (editing copy)" : "（编辑副本）"}`;
    content.snapshot[content.kind === "sheet" ? "name" : "title"] = content.title;
    assertNativeOfficeRuntimeContent(content);
  } catch (error) {
    if (/^NATIVE_(?:DOCUMENT|OFFICE)_/.test(error.message)) throw new AppError(error.message, 422);
    throw error;
  }
  content.snapshot.custom.modelshot.convertedFrom = { artifactId: id, revision: baseRevision };
  const result = await createNativeOfficeArtifact(userId, source.projectId, content, key, { db, store, hooks: { beforeStage: admission, beforeCommit: admission } });
  return { ...result, sourceArtifactId: id, sourceRevision: baseRevision };
}
