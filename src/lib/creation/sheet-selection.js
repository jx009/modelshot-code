import { sheetAddressesSchema } from "./contracts/sheet.js";

export function validateSheetSelection(input, source) {
  const fail = code => { const error = new Error(code); error.code = code; throw error; };
  if (!source || source.kind !== "sheet") fail("LANGUAGE_SOURCE_MISMATCH");
  if (!sheetAddressesSchema.safeParse(input.addresses).success) fail("LANGUAGE_SELECTION_CHANGED");
  const sheet = source.sheets.find(value => value.id === input.sheetId);
  if (!sheet) fail("LANGUAGE_SELECTION_CHANGED");
  // Blank cells may be selected for filling. Only selected content leaves the
  // server; the fixed full revision remains authoritative for patch validation.
  const selected = new Set(input.addresses);
  return { sheet, selected, cells: sheet.cells.filter(cell => selected.has(cell.address)) };
}
