import { z } from "zod";

export const NATIVE_OFFICE_VERSION = "1.2.0";
export const NATIVE_OFFICE_MAX_BYTES = 2 * 1024 * 1024;
// Room for the revision/key envelope around an individually bounded snapshot.
export const NATIVE_OFFICE_REQUEST_BYTES = NATIVE_OFFICE_MAX_BYTES + 1024;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const encoder = new TextEncoder();

// Persistence validation, NOT permission to execute/render every plugin in an
// imported file. Preserve unknown JSON fields verbatim. The runtime adapter
// must separately check plugins, image bindings and executable/external data.
export function inspectNativeOfficeJson(value) {
  const pending = [{ value, depth: 0 }], ancestors = new WeakSet();
  let nodes = 0, characters = 0;
  while (pending.length) {
    const { value: item, depth, exit } = pending.pop();
    if (exit) { ancestors.delete(item); continue; }
    if (++nodes > 250000 || depth > 64) return "NATIVE_OFFICE_COMPLEXITY_LIMIT";
    if (typeof item === "string") characters += item.length;
    else if (item === null || typeof item === "boolean") { /* JSON scalar. */ }
    else if (typeof item === "number") { if (!Number.isFinite(item)) return "NATIVE_OFFICE_JSON_INVALID"; }
    else if (typeof item !== "object") return "NATIVE_OFFICE_JSON_INVALID";
    else {
      if (ancestors.has(item)) return "NATIVE_OFFICE_JSON_INVALID";
      ancestors.add(item); pending.push({ value: item, exit: true });
      if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return "NATIVE_OFFICE_JSON_INVALID";
      const keys = Object.keys(item);
      if (Object.getOwnPropertySymbols(item).length || nodes + pending.length + keys.length > 250000) return "NATIVE_OFFICE_COMPLEXITY_LIMIT";
      if (Object.getOwnPropertyNames(item).length !== keys.length + (Array.isArray(item) ? 1 : 0)) return "NATIVE_OFFICE_JSON_INVALID";
      if (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) return "NATIVE_OFFICE_JSON_INVALID";
      for (const key of keys) {
        if (["__proto__", "prototype", "constructor"].includes(key)) return "NATIVE_OFFICE_JSON_INVALID";
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) return "NATIVE_OFFICE_JSON_INVALID";
        characters += key.length;
        pending.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
    // A cheap bound before encoding the final JSON, including multibyte text.
    if (characters > NATIVE_OFFICE_MAX_BYTES) return "NATIVE_OFFICE_TOO_LARGE";
  }
  if (encoder.encode(JSON.stringify(value)).byteLength > NATIVE_OFFICE_MAX_BYTES) return "NATIVE_OFFICE_TOO_LARGE";
  return null;
}

function snapshotShape(content) {
  const data = content.snapshot;
  if (!record(data) || !id.safeParse(data.id).success) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
  if (content.kind === "document") {
    if (!record(data.body) || typeof data.body.dataStream !== "string" || data.body.dataStream.length > 300000 || !record(data.documentStyle)) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
    if (data.title !== undefined && data.title !== content.title) return "NATIVE_OFFICE_TITLE_MISMATCH";
  } else {
    if (data.name !== content.title) return "NATIVE_OFFICE_TITLE_MISMATCH";
    if (typeof data.appVersion !== "string" || data.appVersion.length > 128 || !record(data.styles) || !record(data.sheets) || !Array.isArray(data.sheetOrder)
      || !data.sheetOrder.length || data.sheetOrder.length > 20 || new Set(data.sheetOrder).size !== data.sheetOrder.length
      || Object.keys(data.sheets).length !== data.sheetOrder.length) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
    let cells = 0;
    for (const sheetId of data.sheetOrder) {
      if (!id.safeParse(sheetId).success || !Object.hasOwn(data.sheets, sheetId)) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
      const sheet = data.sheets[sheetId];
      if (!record(sheet) || sheet.id !== sheetId || typeof sheet.name !== "string" || !sheet.name.length || sheet.name.length > 31
        || !integer(sheet.rowCount, 1, 1048576) || !integer(sheet.columnCount, 1, 16384) || !record(sheet.cellData)) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
      for (const [row, columns] of Object.entries(sheet.cellData)) {
        if (!/^(0|[1-9][0-9]*)$/.test(row) || !integer(Number(row), 0, sheet.rowCount - 1) || !record(columns)) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
        for (const [column, cell] of Object.entries(columns)) {
          if (!/^(0|[1-9][0-9]*)$/.test(column) || !integer(Number(column), 0, sheet.columnCount - 1) || cell !== null && !record(cell)) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
          if (++cells > 100000) return "NATIVE_OFFICE_COMPLEXITY_LIMIT";
        }
      }
    }
  }
  if (data.resources !== undefined && (!Array.isArray(data.resources) || data.resources.length > 100
    || data.resources.some(resource => !record(resource) || typeof resource.name !== "string" || !resource.name.length || resource.name.length > 160 || typeof resource.data !== "string")
    || new Set(data.resources.map(resource => resource.name)).size !== data.resources.length)) return "NATIVE_OFFICE_SNAPSHOT_INVALID";
  return null;
}

export const nativeOfficeArtifactSchema = z.object({
  schemaVersion: z.literal(2), kind: z.enum(["document", "sheet"]), title: z.string().min(1).max(160),
  engine: z.literal("univer"), engineVersion: z.literal(NATIVE_OFFICE_VERSION),
  // Explicit references stay private and are ownership-checked on every save.
  // They are retention metadata, not an assertion that a snapshot is safe to
  // load. Runtime image bindings must be resolved by the type-specific adapter.
  assetIds: z.array(id).max(100).refine(ids => new Set(ids).size === ids.length, "DUPLICATE_NATIVE_ASSET"),
  snapshot: z.unknown(),
}).strict().superRefine((content, ctx) => {
  const error = inspectNativeOfficeJson(content) || snapshotShape(content);
  if (error) ctx.addIssue({ code: "custom", message: error });
});

export const saveNativeOfficeArtifactSchema = z.object({
  baseRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: nativeOfficeArtifactSchema,
}).strict();
export const copyNativeOfficeArtifactSchema = z.object({ saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/), content: nativeOfficeArtifactSchema }).strict();
export const restoreNativeOfficeArtifactSchema = z.object({ baseRevision: z.number().int().positive(), restoreRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/) }).strict();
export const nativeOfficeAssetIds = content => content.assetIds;
export const convertNativeOfficeArtifactSchema = z.object({ baseRevision: z.number().int().positive(), saveKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/) }).strict();
