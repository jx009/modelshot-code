import { AppError } from "../../http.js";
import { createArtifactService } from "./artifact-service.js";
import { nativeOfficeArtifactSchema, nativeOfficeAssetIds } from "../../creation/contracts/native-office.js";
import { nativeSheetOperationsSchema } from "../../creation/contracts/native-sheet-edit.js";
import { applyNativeSheetOperations, NativeSheetEditError } from "../../creation/native-sheet-edit.js";
import { nativeDocumentOperationsSchema } from "../../creation/contracts/native-document-edit.js";
import { applyNativeDocumentOperations, NativeDocumentEditError } from "../../creation/native-document-edit.js";
import { officeEqual, officeImportMetadata } from "../../creation/office/identity.js";
import { validateImportedReplacement } from "../../creation/office/protection.js";

// No browser engine imports or semantic projection in this storage codec.
// Native read/save/copy/restore routes preserve existing revisions. Creation
// remains internal until runtime/data adapters pass product acceptance.
const services = Object.fromEntries(["document", "sheet"].map(kind => {
  const schema = nativeOfficeArtifactSchema.refine(content => content.kind === kind, "ARTIFACT_KIND_MISMATCH");
  return [kind, createArtifactService({ documentSchema: schema, replacementSchema: schema, projectKind: kind,
    operationsSchema: kind === "sheet" ? nativeSheetOperationsSchema : nativeDocumentOperationsSchema, assetIds: nativeOfficeAssetIds,
    applyOperations: kind === "sheet" ? applyNativeSheetOperations : applyNativeDocumentOperations, OperationError: kind === "sheet" ? NativeSheetEditError : NativeDocumentEditError,
    validateReplacement: (current, next) => {
      if (current.snapshot.id !== next.snapshot.id) throw new AppError("NATIVE_OFFICE_ID_CHANGED", 422);
      try { validateImportedReplacement(current, next); } catch (error) { throw new AppError(error.code, 422); }
    },
    validateOwnership: async (userId, content, db) => {
      const meta = officeImportMetadata(content);
      if (!meta) return;
      const source = await db.creationImport.findFirst({ where: { id: meta.sourceId, userId, status: { in: ["running", "succeeded"] }, sourceBlob: { userId, state: "ready" } }, select: { report: true } });
      if (!source || !officeEqual(source.report?.metadata, meta) || source.report?.unitId !== content.snapshot.id) throw new AppError("OFFICE_IMPORT_IDENTITY_CHANGED", 422);
    },
  })];
}));
function service(kind) {
  if (!Object.hasOwn(services, kind)) throw new AppError("ARTIFACT_KIND_MISMATCH", 422);
  return services[kind];
}
export function createNativeOfficeArtifact(userId, projectId, content, saveKey, options) {
  return service(content?.kind).createLayoutArtifact(userId, projectId, content, saveKey, options);
}
export function readNativeOfficeArtifact(userId, id, kind, revision, options) {
  return service(kind).readLayoutArtifact(userId, id, revision, options);
}
export function saveNativeOfficeArtifact(userId, id, input, options) {
  return service(input?.content?.kind).replaceLayoutArtifact(userId, id, input, options);
}
// Internal controlled operations only; manual full replacements still reject
// sourceRunId. Publication validates the fixed revision's selected scope first.
export function modifyNativeSheetArtifact(userId, id, input, options) {
  return service("sheet").modifyLayoutArtifact(userId, id, input, options);
}
export function modifyNativeDocumentArtifact(userId, id, input, options) {
  return service("document").modifyLayoutArtifact(userId, id, input, options);
}
export function copyNativeOfficeArtifact(userId, id, input, options) {
  return service(input?.content?.kind).copyLayoutArtifact(userId, id, input, options);
}
export function restoreNativeOfficeArtifact(userId, id, kind, input, options) {
  return service(kind).restoreLayoutArtifact(userId, id, input, options);
}
