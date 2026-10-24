import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convertNativeOfficeArtifact } from "../../src/lib/domain/creation/native-office-conversion.js";
import { POST } from "../../src/app/api/creation/artifacts/[id]/native/convert/route.js";
const ports = vi.hoisted(() => ({ owned: vi.fn(), document: vi.fn(), sheet: vi.fn(), create: vi.fn(), user: vi.fn(), rate: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => ({}) }));
vi.mock("../../src/lib/domain/creation/artifacts.js", () => ({ ownedArtifact: (...args) => ports.owned(...args) }));
vi.mock("../../src/lib/domain/creation/document-artifacts.js", () => ({ readDocumentArtifact: (...args) => ports.document(...args) }));
vi.mock("../../src/lib/domain/creation/sheet-artifacts.js", () => ({ readSheetArtifact: (...args) => ports.sheet(...args) }));
vi.mock("../../src/lib/domain/creation/native-office-artifacts.js", () => ({ createNativeOfficeArtifact: (...args) => ports.create(...args) }));
vi.mock("../../src/lib/require-user", () => ({ requireUser: (...args) => ports.user(...args) }));
vi.mock("../../src/lib/domain/identity/rate-limit", () => ({ rateLimit: (...args) => ports.rate(...args) }));
const request = { baseRevision: 3, saveKey: "convert-key-1234567" }, options = { db: {}, store: {} };
const document = () => ({ schemaVersion: 1, kind: "document", title: "Report", sections: [{ id: "s", title: "Topic", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "Original" }] }] }] });
beforeEach(() => {
  Object.values(ports).forEach(port => port.mockReset());
  vi.stubEnv("CREATION_WORKSPACE_ENABLED", "true"); vi.stubEnv("CREATION_NATIVE_OFFICE_ENABLED", "true");
  ports.owned.mockResolvedValue({ kind: "document" }); ports.document.mockResolvedValue({ projectId: "project", revision: 3, content: document() });
  ports.create.mockImplementation(async (_user, _project, _content, _key, settings) => { settings.hooks.beforeStage(); settings.hooks.beforeCommit(); return { artifactId: "copy", revision: 1, replayed: false }; });
  ports.user.mockResolvedValue({ id: "u" });
});
afterEach(() => vi.unstubAllEnvs());

it("adapts the fixed owned revision and derives stable ids/keys for retries without changing the source", async () => {
  const original = document(); ports.document.mockResolvedValue({ projectId: "project", content: original });
  const result = await convertNativeOfficeArtifact("u", "source", request, options);
  await convertNativeOfficeArtifact("u", "source", request, options);
  expect(result).toMatchObject({ artifactId: "copy", sourceArtifactId: "source", sourceRevision: 3 });
  expect(ports.owned).toHaveBeenCalledWith("u", "source", options.db);
  expect(ports.document).toHaveBeenCalledWith("u", "source", 3, options);
  const first = ports.create.mock.calls[0], second = ports.create.mock.calls[1];
  expect(first.slice(0, 4)).toEqual(second.slice(0, 4));
  expect(first[2].snapshot.custom.modelshot.convertedFrom).toEqual({ artifactId: "source", revision: 3 });
  expect(original).toEqual(document()); expect(ports.sheet).not.toHaveBeenCalled();
});

it("uses the sheet adapter for sheet revisions and preserves the request key scope across source revisions", async () => {
  ports.owned.mockResolvedValue({ kind: "sheet" }); ports.sheet.mockResolvedValue({ projectId: "project", content: { schemaVersion: 1, kind: "sheet", title: "Book", sheets: [{ id: "s", name: "Sheet", cells: [] }] } });
  await convertNativeOfficeArtifact("u", "source", request, options);
  await convertNativeOfficeArtifact("u", "source", { ...request, baseRevision: 4 }, options);
  expect(ports.create.mock.calls[0][2].kind).toBe("sheet");
  expect(ports.create.mock.calls[0][3]).toBe(ports.create.mock.calls[1][3]); // Storage rejects reused keys with changed source content/digest.
  expect(ports.create.mock.calls[1][2].snapshot.custom.modelshot.convertedFrom.revision).toBe(4);
  expect(ports.document).not.toHaveBeenCalled();
});

it("closes new admissions by default, validates locks, and never accepts client-provided replacement content", async () => {
  vi.stubEnv("CREATION_NATIVE_OFFICE_ENABLED", "false");
  await expect(convertNativeOfficeArtifact("u", "source", request, options)).rejects.toThrow("NATIVE_OFFICE_NOT_ENABLED");
  const source = document(); source.sections[0].blocks[0].locked = true; ports.document.mockResolvedValue({ projectId: "project", content: source });
  ports.create.mockClear();
  await expect(convertNativeOfficeArtifact("u", "source", request, options)).rejects.toThrow("NATIVE_DOCUMENT_LOCKED_CONTENT");
  await expect(convertNativeOfficeArtifact("u", "source", { ...request, content: document() }, options)).rejects.toThrow();
  expect(ports.create).not.toHaveBeenCalled();
});

it("uses authenticated, origin-checked bounded JSON and reports copy creation without enabling the feature", async () => {
  const context = { params: Promise.resolve({ id: "source" }) }, url = "https://example.test/api/creation/artifacts/source/native/convert";
  const make = (body, headers = {}) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const response = await POST(make(request), context);
  expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(ports.rate).toHaveBeenCalledWith("creation-native-convert", "u", 10, 60);
  expect((await POST(make(request, { origin: "https://other.test" }), context)).status).toBe(403);
  expect((await POST(make({ ...request, content: {} }), context)).status).toBe(400);
  expect((await POST(make(request, { "content-length": "1025" }), context)).status).toBe(413);
});
