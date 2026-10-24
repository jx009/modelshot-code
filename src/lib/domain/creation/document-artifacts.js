import { createArtifactService } from "./artifact-service.js";
import { textDocumentSchema, documentOperationsSchema, documentAssetIds } from "../../creation/contracts/document.js";
import { applyDocumentOperations, DocumentOperationError } from "../../creation/document-operations.js";
import { AppError } from "../../http.js";

const service = createArtifactService({ documentSchema: textDocumentSchema, operationsSchema: documentOperationsSchema,
  projectKind: "document",
  assetIds: documentAssetIds, applyOperations: applyDocumentOperations, OperationError: DocumentOperationError,
  validateAgentOperations: operations => { if (operations.some(op => op.op === "setDocumentLock")) throw new AppError("AI_CANNOT_CHANGE_LOCK", 422); },
});
export const createDocumentArtifact = service.createLayoutArtifact;
export const readDocumentArtifact = service.readLayoutArtifact;
export const modifyDocumentArtifact = service.modifyLayoutArtifact;
export const copyDocumentArtifact = service.copyLayoutArtifact;
export const restoreDocumentArtifact = service.restoreLayoutArtifact;
