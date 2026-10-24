import { z } from "zod";
import { layoutDocumentSchema, layoutOperationsSchema, layoutAssetIds } from "./contracts/layout.js";
import { applyLayoutOperations } from "./layout-operations.js";
import { applyWithInverse } from "./layout-history.js";
import { htmlDocumentSchema, htmlAssetIds, isHtmlDocument } from "./html/document.js";
import { htmlOperationsSchema, applyHtmlOperations, applyHtmlWithInverse } from "./html/operations.js";

export const artworkDocumentSchema = z.union([htmlDocumentSchema, layoutDocumentSchema]);
export const artworkOperationsSchema = z.union([htmlOperationsSchema, layoutOperationsSchema]);
export const artworkAssetIds = doc => isHtmlDocument(doc) ? htmlAssetIds(doc) : layoutAssetIds(doc);
export const applyArtworkOperations = (doc, ops) => isHtmlDocument(doc) ? applyHtmlOperations(doc, ops) : applyLayoutOperations(doc, ops);
export const applyArtworkWithInverse = (doc, ops) => isHtmlDocument(doc) ? applyHtmlWithInverse(doc, ops) : applyWithInverse(doc, ops);
