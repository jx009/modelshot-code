import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as read, PUT as save } from "../../src/app/api/creation/artifacts/[id]/native/route.js";
import { POST as copy } from "../../src/app/api/creation/artifacts/[id]/native/copy/route.js";
import { POST as restore } from "../../src/app/api/creation/artifacts/[id]/native/restore/route.js";
import { GET as format } from "../../src/app/api/creation/artifacts/[id]/format/route.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { NATIVE_OFFICE_REQUEST_BYTES } from "../../src/lib/creation/contracts/native-office.js";
import { AppError } from "../../src/lib/http.js";
const ports = vi.hoisted(() => ({ user: vi.fn(), owned: vi.fn(), rate: vi.fn(), read: vi.fn(), save: vi.fn(), copy: vi.fn(), restore: vi.fn() }));
vi.mock("../../src/lib/require-user", () => ({ requireUser: (...args) => ports.user(...args) }));
vi.mock("../../src/lib/domain/identity/rate-limit", () => ({ rateLimit: (...args) => ports.rate(...args) }));
vi.mock("../../src/lib/domain/creation/artifacts", () => ({ ownedArtifact: (...args) => ports.owned(...args) }));
vi.mock("../../src/lib/domain/creation/native-office-artifacts", () => ({ readNativeOfficeArtifact: (...args) => ports.read(...args), saveNativeOfficeArtifact: (...args) => ports.save(...args), copyNativeOfficeArtifact: (...args) => ports.copy(...args), restoreNativeOfficeArtifact: (...args) => ports.restore(...args) }));
const root = "https://example.test/api/creation/artifacts/artifact/native", context = { params: Promise.resolve({ id: "artifact" }) };
const content = () => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Costs", sheets: [{ id: "s", name: "Costs", cells: [] }] }, "unit");
const body = () => ({ baseRevision: 2, saveKey: "native-request-123456", content: content() });
const request = (data, method = "PUT", headers = {}) => new Request(root, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
beforeEach(() => {
  Object.values(ports).forEach(port => port.mockReset());
  ports.user.mockResolvedValue({ id: "u" }); ports.owned.mockResolvedValue({ kind: "sheet" });
  for (const name of ["save", "copy", "restore"]) ports[name].mockResolvedValue({ artifactId: "artifact", revision: 3 });
  ports.read.mockResolvedValue({ content: content(), revision: 2 });
});
afterEach(() => vi.unstubAllEnvs());

it("resolves only owned format metadata without reading snapshot blobs or leaking project details", async () => {
  ports.owned.mockResolvedValueOnce({ id: "artifact", kind: "sheet", schemaVersion: 2, projectId: "private-project", name: "Private title" });
  const response = await format(new Request(root.replace("/native", "/format")), context);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ id: "artifact", kind: "sheet", schemaVersion: 2, canConvertNative: false, canReferenceNative: false });
  expect(ports.read).not.toHaveBeenCalled(); expect(ports.owned).toHaveBeenCalledWith("u", "artifact");
  ports.owned.mockRejectedValueOnce(new AppError("ARTIFACT_NOT_FOUND", 404));
  expect((await format(new Request(root), context)).status).toBe(404);
});

it("reads the owner-resolved kind and exact revision with private cache policy and rejects malformed versions", async () => {
  const response = await read(new Request(`${root}?revision=2&kind=document`), context);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(ports.read).toHaveBeenCalledExactlyOnceWith("u", "artifact", "sheet", 2);
  for (const version of ["", "0", "-1", "1.5", "2e2", "Infinity", "9007199254740992"]) expect((await read(new Request(`${root}?revision=${version}`), context)).status).toBe(400);
  expect(ports.read).toHaveBeenCalledOnce();
  ports.owned.mockResolvedValue({ kind: "poster" }); expect((await read(new Request(root), context)).status).toBe(422);
});

it("exposes native sheet referencing only when every required creation admission flag is enabled", async () => {
  ports.owned.mockResolvedValue({ id: "artifact", kind: "sheet", schemaVersion: 2 });
  const flags = ["CREATION_RUNS_ENABLED", "CREATION_WORKSPACE_ENABLED", "CREATION_SHEET_ENABLED", "CREATION_NATIVE_OFFICE_ENABLED"];
  for (const flag of flags) vi.stubEnv(flag, "true");
  expect((await (await format(new Request(root), context)).json()).canReferenceNative).toBe(true);
  for (const flag of flags) {
    vi.stubEnv(flag, "false");
    expect((await (await format(new Request(root), context)).json()).canReferenceNative).toBe(false);
    vi.stubEnv(flag, "true");
  }
  ports.owned.mockResolvedValue({ id: "artifact", kind: "document", schemaVersion: 2 });
  vi.stubEnv("CREATION_DOCUMENT_ENABLED", "false");
  expect((await (await format(new Request(root), context)).json()).canReferenceNative).toBe(false);
  vi.stubEnv("CREATION_DOCUMENT_ENABLED", "true");
  expect((await (await format(new Request(root), context)).json()).canReferenceNative).toBe(true);
  expect(ports.read).not.toHaveBeenCalled();
});

it("preserves plugin bytes in snapshot saves, rate limits writes and allows recovery with new admission disabled", async () => {
  vi.stubEnv("CREATION_WORKSPACE_ENABLED", "false");
  const input = body(); input.content.snapshot.resources.push({ name: "plugin", data: '{"notes":"完整保留"}' });
  const response = await save(request(input), context);
  expect(response.status).toBe(200); expect(ports.save).toHaveBeenCalledExactlyOnceWith("u", "artifact", input);
  expect(ports.rate).toHaveBeenCalledWith("creation-native-save", "u", 30, 60);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await copy(request({ saveKey: input.saveKey, content: input.content }, "POST"), context)).status).toBe(201);
  expect(ports.rate).toHaveBeenCalledWith("creation-native-copy", "u", 10, 60);
  const restoreInput = { baseRevision: 3, restoreRevision: 1, saveKey: input.saveKey };
  expect((await restore(request(restoreInput, "POST"), context)).status).toBe(200);
  expect(ports.restore).toHaveBeenCalledExactlyOnceWith("u", "artifact", "sheet", restoreInput);
});

it("requires authentication, origin, content type, exact envelope and bounded streamed body before writing", async () => {
  ports.user.mockRejectedValueOnce(new AppError("UNAUTHENTICATED", 401));
  expect((await save(request(body()), context)).status).toBe(401);
  expect((await save(request(body(), "PUT", { origin: "https://other.test" }), context)).status).toBe(403);
  expect((await save(request(body(), "PUT", { "content-type": "text/plain" }), context)).status).toBe(415);
  expect((await save(request({ ...body(), sourceRunId: "injected" }), context)).status).toBe(400);
  expect((await save(request(body(), "PUT", { "content-length": String(NATIVE_OFFICE_REQUEST_BYTES + 1) }), context)).status).toBe(413);
  const large = new Request(root, { method: "PUT", headers: { "content-type": "application/json" }, body: '"' + "x".repeat(NATIVE_OFFICE_REQUEST_BYTES) + '"' });
  expect((await save(large, context)).status).toBe(413);
  expect(ports.save).not.toHaveBeenCalled();
});

it("returns ownership, conflict and format errors without exposing another artifact or changing the save key", async () => {
  ports.owned.mockRejectedValueOnce(new AppError("ARTIFACT_NOT_FOUND", 404));
  expect((await read(new Request(root), context)).status).toBe(404); expect(ports.read).not.toHaveBeenCalled();
  ports.save.mockRejectedValueOnce(new AppError("ARTIFACT_VERSION_CONFLICT", 409));
  const response = await save(request(body()), context);
  expect(response.status).toBe(409); expect((await response.json()).code).toBe("ARTIFACT_VERSION_CONFLICT");
  expect(ports.save.mock.calls[0][2].saveKey).toBe(body().saveKey);
  ports.read.mockRejectedValueOnce(new AppError("ARTIFACT_FORMAT_UNSUPPORTED", 422));
  expect((await read(new Request(root), context)).status).toBe(422);
});
