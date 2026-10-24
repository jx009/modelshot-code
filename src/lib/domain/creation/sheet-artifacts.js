import { createArtifactService } from "./artifact-service.js";
import { workbookSchema, sheetOperationSchema, sheetAssetIds } from "../../creation/contracts/sheet.js";
import { applySheetOperations, SheetOperationError } from "../../creation/sheet-operations.js";
import { AppError } from "../../http.js";
const service = createArtifactService({ documentSchema: workbookSchema, operationsSchema: sheetOperationSchema, projectKind: "sheet", assetIds: sheetAssetIds, applyOperations: applySheetOperations, OperationError: SheetOperationError,
  validateAgentOperations: operations => { if (operations.some(op => op.op === "setFreeze")) throw new AppError("AI_CANNOT_CHANGE_SHEET_VIEW", 422); } });
export const createSheetArtifact = service.createLayoutArtifact;
export const readSheetArtifact = service.readLayoutArtifact;
export const modifySheetArtifact = service.modifyLayoutArtifact;
export const copySheetArtifact = service.copyLayoutArtifact;
export const restoreSheetArtifact = service.restoreLayoutArtifact;
