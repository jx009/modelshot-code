import { createArtifactService } from "./artifact-service.js";
import { artworkDocumentSchema as layoutDocumentSchema, artworkOperationsSchema as layoutOperationsSchema, artworkAssetIds as layoutAssetIds, applyArtworkOperations as applyLayoutOperations } from "../../creation/artwork-codec.js";
import { LayoutOperationError } from "../../creation/layout-operations.js";
import { AppError } from "../../http.js";

// Existing image/PPT entrypoints retain their public contract. Document engines
// use a separate codec while sharing ownership, version CAS and blob lifecycle.
export const { ownedArtifact, createLayoutArtifact, copyLayoutArtifact, readLayoutArtifact, modifyLayoutArtifact, restoreLayoutArtifact, listArtifactRevisions, cleanupStagedBlobs } = createArtifactService({
  documentSchema: layoutDocumentSchema, operationsSchema: layoutOperationsSchema,
  assetIds: layoutAssetIds, applyOperations: applyLayoutOperations, OperationError: LayoutOperationError,
  invalidResultCode: "INVALID_LAYOUT_RESULT",
  validateAgentOperations: operations => {
    if (operations.some(op => op.op === "replacePageLayout")) throw new AppError("LANGUAGE_EDIT_OUTSIDE_SCOPE", 422);
    if (operations.some(op => op.op === "setNode" && op.changes.locked === false)) throw new AppError("AI_CANNOT_UNLOCK_NODE", 422);
  },
});
