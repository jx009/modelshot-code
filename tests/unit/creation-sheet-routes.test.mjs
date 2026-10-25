import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as create } from "../../src/app/api/creation/sheet-artifacts/route.js";
import { GET as read, PATCH as save } from "../../src/app/api/creation/artifacts/[id]/sheet/route.js";
import { POST as copy } from "../../src/app/api/creation/artifacts/[id]/sheet/copy/route.js";
import { POST as restore } from "../../src/app/api/creation/artifacts/[id]/sheet/restore/route.js";
import { rateLimit } from "../../src/lib/domain/identity/rate-limit";
const mock = vi.hoisted(() => ({ project: vi.fn(), create: vi.fn(), read: vi.fn(), save: vi.fn(), copy: vi.fn(), restore: vi.fn() }));
vi.mock("../../src/lib/creation/require-user", () => ({ requireCreationUser: async () => ({ id: "u", creationEnv: process.env }) }));
vi.mock("../../src/lib/domain/identity/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { creationProject: { findFirst: (...args) => mock.project(...args) } } }));
vi.mock("../../src/lib/domain/creation/sheet-artifacts", () => ({ createSheetArtifact: (...args) => mock.create(...args), readSheetArtifact: (...args) => mock.read(...args), modifySheetArtifact: (...args) => mock.save(...args), copySheetArtifact: (...args) => mock.copy(...args), restoreSheetArtifact: (...args) => mock.restore(...args) }));
const context = { params: Promise.resolve({ id: "sheet" }) }, request = body => new Request("https://example.test/api/creation/sheet-artifacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const content = { schemaVersion: 1, kind: "sheet", title: "Sales", sheets: [{ id: "s", name: "Sales", cells: [{ id: "a1", address: "A1", value: 1 }] }] };
beforeEach(() => { vi.stubEnv("CREATION_WORKSPACE_ENABLED", "true"); vi.stubEnv("CREATION_SHEET_ENABLED", "true"); Object.values(mock).forEach(fn => fn.mockReset().mockResolvedValue({ artifactId: "sheet", revision: 1 })); mock.project.mockResolvedValue({ id: "project" }); });
afterEach(() => vi.unstubAllEnvs());
it("gates creation independently and passes a normalized workbook to the codec", async () => {
  const response = await create(request({ projectId: "project", saveKey: "create-sheet-key-123", content }));
  expect(response.status).toBe(200); expect(mock.create.mock.calls[0][2].sheets[0].freezeRows).toBe(0); expect(mock.project.mock.calls[0][0].where.kind).toBe("sheet");
  vi.stubEnv("CREATION_SHEET_ENABLED", "false"); expect((await create(request({ projectId: "project", saveKey: "create-sheet-key-123", content }))).status).toBe(503); expect(mock.create).toHaveBeenCalledOnce();
});
it("passes a fixed revision and rejects malformed or oversized patches before the domain service", async () => {
  await read(new Request("https://example.test/api/creation/artifacts/sheet/sheet?revision=4"), context); expect(mock.read).toHaveBeenCalledWith("u", "sheet", 4);
  const body = { baseRevision: 4, saveKey: "save-sheet-key-123", operations: [{ op: "setCell", sheetId: "s", address: "A1", id: "a1", value: 2 }] };
  expect((await save(new Request("https://example.test/api/creation/artifacts/sheet/sheet", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), context)).status).toBe(200); expect(mock.save).toHaveBeenCalledOnce();
  expect((await save(new Request("https://example.test/api/creation/artifacts/sheet/sheet", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, operations: Array.from({ length: 101 }, () => body.operations[0]) }) }), context)).status).toBe(400); expect(mock.save).toHaveBeenCalledOnce();
});
it("rate limits copy and restore while keeping existing artifact writes available when admission is off", async () => {
  vi.stubEnv("CREATION_SHEET_ENABLED", "false");
  expect((await copy(request({ saveKey: "copy-sheet-key-123", content }), context)).status).toBe(200);
  expect(rateLimit).toHaveBeenCalledWith("creation-sheet-copy", "u", 10, 60);
  expect(mock.copy.mock.calls[0].slice(0, 2)).toEqual(["u", "sheet"]);
  expect((await restore(request({ saveKey: "restore-sheet-key-123", baseRevision: 3, restoreRevision: 1 }), context)).status).toBe(200);
  expect(rateLimit).toHaveBeenCalledWith("creation-sheet-restore", "u", 10, 60);
  expect(mock.restore).toHaveBeenCalledWith("u", "sheet", { saveKey: "restore-sheet-key-123", baseRevision: 3, restoreRevision: 1 });
  const oversized = new Request("https://example.test/api/creation/sheet", { method: "POST", headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1) }, body: "{}" });
  expect((await copy(oversized, context)).status).toBe(413); expect(mock.copy).toHaveBeenCalledOnce();
});
