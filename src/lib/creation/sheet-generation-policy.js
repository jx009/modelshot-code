export const SHEET_CHUNK_ROWS = 25;
export function sheetGenerationCalls(sheetCount, targetRows) { return sheetCount > 1 || targetRows > SHEET_CHUNK_ROWS ? 1 + sheetCount * Math.ceil(targetRows / SHEET_CHUNK_ROWS) : 1; }
