import { createArtifactService } from "./artifact-service.js";
import { webSchema } from "../../creation/contracts/web.js";
import { webOperationsSchema } from "../../creation/contracts/web.js";
import { applyWebOperations, WebOperationError } from "../../creation/web-operations.js";
import { AppError } from "../../http.js";

const service = createArtifactService({
  documentSchema: webSchema, operationsSchema: webOperationsSchema, assetIds: site => site.assetIds,
  applyOperations: applyWebOperations, OperationError: WebOperationError, projectKind: "web", invalidResultCode: "INVALID_WEB_RESULT",
  validateAgentOperations: operations => {
    if (operations.some(operation => operation.op !== "setFile")) throw new AppError("LANGUAGE_EDIT_OUTSIDE_SCOPE", 422);
    if (operations.some(operation => !["html", "css", "js"].includes(operation.kind))) throw new AppError("LANGUAGE_EDIT_OUTSIDE_SCOPE", 422);
  },
});
export const { ownedArtifact, listArtifactRevisions, cleanupStagedBlobs } = service;
export const createWebArtifact = service.createLayoutArtifact;
export const copyWebArtifact = service.copyLayoutArtifact;
export const readWebArtifact = service.readLayoutArtifact;
export const modifyWebArtifact = service.modifyLayoutArtifact;
export const restoreWebArtifact = service.restoreLayoutArtifact;
