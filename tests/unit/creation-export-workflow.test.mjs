import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../../src/lib/http.js";
import { EXPORTER_VERSION, exportFormat } from "../../src/lib/creation/contracts/exports.js";
import { executeArtifactExport, recoverArtifactExports } from "../../src/lib/domain/creation/export-execution.js";
import { requestArtifactExport, listArtifactExports } from "../../src/lib/domain/creation/exports.js";

const mock = vi.hoisted(() => ({ readLayout: vi.fn(), format: vi.fn(), owned: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("No real storage in unit tests"); } }));
vi.mock("../../src/lib/domain/creation/artifacts.js", () => ({ readLayoutArtifact: (...args) => mock.readLayout(...args), ownedArtifact: (...args) => mock.owned(...args) }));
vi.mock("../../src/lib/domain/creation/export-source.js", () => ({ readExportSourceFormat: (...args) => mock.format(...args) }));
const origin = Date.parse("2026-10-24T00:00:00Z");
const bytes = Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3]);
const content = () => ({ schemaVersion: 1, kind: "slides", title: "Fixed revision", theme: { name: "Test", primary: "#000000", accent: "#ff0000", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "page", title: "Page", width: 640, height: 360, nodes: [] }] });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(origin);
  Object.values(mock).forEach(value => value.mockReset());
  mock.owned.mockResolvedValue({ id: "artifact", kind: "slides" });
  mock.readLayout.mockResolvedValue({ id: "artifact", content: content() });
  mock.format.mockResolvedValue({ revisionId: "revision-record", checksum: "source-checksum", schemaVersion: 1, kind: "slides" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function fixture(overrides = {}) {
  const state = { row: { id: "export", userId: "u", revisionId: "revision-record", revision: { artifactId: "artifact", revision: 7 },
    status: "queued", format: "pptx", exporterVersion: EXPORTER_VERSION, attempt: 0, attemptLimit: 3, leaseUntil: null,
    nextCheckAt: new Date(origin), deadlineAt: new Date(origin + 15 * 60000), createdAt: new Date(origin), errorCode: null, ...overrides } };
  const apply = data => { for (const [key, value] of Object.entries(data)) state.row[key] = value?.increment ? state.row[key] + value.increment : value; return structuredClone(state.row); };
  const matches = where => (!where.status || state.row.status === where.status) && (where.attempt === undefined || state.row.attempt === where.attempt)
    && (!where.leaseUntil || state.row.leaseUntil > where.leaseUntil.gt) && (!where.deadlineAt || state.row.deadlineAt > where.deadlineAt.gt);
  const db = {
    $queryRaw: vi.fn(), user: { findUnique: vi.fn(async () => ({ id: "u", status: "active" })) },
    artifactExport: {
      findUnique: vi.fn(async ({ where }) => where.fingerprint ? null : structuredClone(state.row)),
      findMany: vi.fn(async ({ where }) => state.row && where.status.in.includes(state.row.status) && state.row.nextCheckAt <= where.nextCheckAt.lte ? [structuredClone(state.row)] : []),
      count: vi.fn(async () => 0), create: vi.fn(async ({ data }) => { state.row = { ...state.row, ...data }; return structuredClone(state.row); }),
      update: vi.fn(async ({ data }) => apply(data)),
      updateMany: vi.fn(async ({ where, data }) => { if (!matches(where)) return { count: 0 }; apply(data); return { count: 1 }; }),
    },
    serviceHeartbeat: { findUnique: vi.fn(async () => ({ updatedAt: new Date(), details: { exporters: { pptx: EXPORTER_VERSION } } })) },
    artifactRevision: { findUnique: vi.fn(async () => ({ id: "revision-record", blob: { state: "ready", userId: "u", checksum: "source-checksum" } })) },
    creationArtifact: { findFirst: vi.fn(async () => ({ id: "artifact" })) },
    creationBlob: { create: vi.fn(async ({ data }) => ({ id: "blob", ...data })), updateMany: vi.fn(async () => ({ count: 1 })) },
    asset: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
  };
  db.$transaction = async fn => fn(db);
  const store = { put: vi.fn() }, render = vi.fn(async () => bytes);
  return { state, db, store, render };
}

it.each(["poster", "slides"])("requires independent PDF admission and exports the fixed %s revision with only visible assets", async kind => {
  const descriptor = exportFormat("pdf"), value = fixture({ format: "pdf", exporterVersion: descriptor.version });
  const request = { revision: 7, format: "pdf" };
  mock.owned.mockResolvedValue({ id: "artifact", kind });
  mock.format.mockResolvedValue({ revisionId: "revision-record", checksum: "source-checksum", schemaVersion: 1, kind });
  await expect(requestArtifactExport("u", "artifact", request, value)).rejects.toThrow("EXPORT_NOT_ENABLED");
  const env = { CREATION_LAYOUT_PDF_EXPORT_ENABLED: "true" };
  await expect(requestArtifactExport("u", "artifact", request, { ...value, env })).rejects.toThrow("EXPORT_WORKER_UNAVAILABLE");
  value.db.serviceHeartbeat.findUnique.mockResolvedValue({ updatedAt: new Date(), details: { exporters: { pdf: descriptor.version } } });
  expect(await requestArtifactExport("u", "artifact", request, { ...value, env })).toMatchObject({ format: "pdf", revision: 7, exporterVersion: descriptor.version });
  const node = { id: "image", name: "Image", type: "image", x: 0, y: 0, width: 40, height: 40, assetId: "photo" };
  const page = { id: "page", title: "Page", width: 640, height: 360, nodes: [node, { ...node, id: "invisible", assetId: "omit", visible: false }] };
  const content = { schemaVersion: 1, kind, title: "Fixed PDF", theme: { name: "Test", primary: "#000000", accent: "#ff0000", background: "#ffffff", fontFamily: "sans" }, pages: [page, ...(kind === "slides" ? [{ ...page, id: "hidden", hidden: true, nodes: [{ ...node, assetId: "hidden-private" }] }] : [])] };
  mock.readLayout.mockResolvedValue({ id: "artifact", content });
  value.db.asset.findMany.mockResolvedValue([{ id: "photo", bytes: 5 }]); value.db.asset.count.mockResolvedValue(1);
  value.render.mockResolvedValue(Buffer.from("%PDF-1.7\nbody\n%%EOF\n"));
  await executeArtifactExport("export", value);
  expect(mock.readLayout).toHaveBeenCalledExactlyOnceWith("u", "artifact", 7, { db: value.db, store: value.store });
  expect(value.db.asset.findMany.mock.calls[0][0].where).toMatchObject({ userId: "u", id: { in: ["photo"] } });
  expect(value.render.mock.calls[0][2]).toMatchObject({ format: "pdf", exporterVersion: descriptor.version });
  expect(value.state.row.status).toBe("succeeded");
  expect(value.store.put.mock.calls[0][2]).toBe("application/pdf");
  expect(value.db.creationBlob.create.mock.calls[0][0].data.objectKey).toMatch(/\.pdf$/);
});

it("fails an all-hidden PDF before assets/rendering and rejects a mislabeled output", async () => {
  const descriptor = exportFormat("pdf"), value = fixture({ format: "pdf", exporterVersion: descriptor.version });
  mock.owned.mockResolvedValue({ id: "artifact", kind: "sheet" });
  await expect(requestArtifactExport("u", "artifact", { revision: 7, format: "pdf" }, value)).rejects.toThrow("EXPORT_KIND_UNSUPPORTED");
  const source = { schemaVersion: 1, kind: "slides", title: "PDF", theme: { name: "Test", primary: "#000000", accent: "#ff0000", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "hidden", title: "Hidden", width: 100, height: 100, hidden: true, nodes: [] }] };
  mock.readLayout.mockResolvedValue({ id: "artifact", content: source });
  await executeArtifactExport("export", value);
  expect(value.state.row).toMatchObject({ status: "failed", errorCode: "EXPORT_PDF_NO_VISIBLE_PAGES" });
  expect(value.db.asset.findMany).not.toHaveBeenCalled(); expect(value.render).not.toHaveBeenCalled();
  source.pages[0].hidden = false;
  const mislabeled = fixture({ format: "pdf", exporterVersion: descriptor.version });
  await executeArtifactExport("export", mislabeled);
  expect(mislabeled.state.row).toMatchObject({ status: "failed", errorCode: "EXPORT_RESULT_INVALID" });
  expect(mislabeled.store.put).not.toHaveBeenCalled();
});

it("requires independent SVG admission and publishes the fixed poster revision with vector MIME", async () => {
  const value = fixture({ format: "svg", exporterVersion: exportFormat("svg").version }), request = { revision: 7, format: "svg" };
  mock.owned.mockResolvedValue({ id: "artifact", kind: "poster" });
  mock.format.mockResolvedValue({ revisionId: "revision-record", checksum: "source-checksum", schemaVersion: 1, kind: "poster" });
  await expect(requestArtifactExport("u", "artifact", request, { ...value, env: { CREATION_POSTER_EXPORT_ENABLED: "true" } })).rejects.toThrow("EXPORT_NOT_ENABLED");
  const env = { CREATION_SVG_EXPORT_ENABLED: "true" };
  await expect(requestArtifactExport("u", "artifact", request, { ...value, env })).rejects.toThrow("EXPORT_WORKER_UNAVAILABLE");
  value.db.serviceHeartbeat.findUnique.mockResolvedValue({ updatedAt: new Date(), details: { exporters: { svg: exportFormat("svg").version } } });
  expect(await requestArtifactExport("u", "artifact", request, { ...value, env })).toMatchObject({ format: "svg", revision: 7 });
  mock.readLayout.mockResolvedValue({ id: "artifact", content: { kind: "poster", pages: [{ nodes: [] }] } });
  value.render.mockResolvedValue(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'));
  await executeArtifactExport("export", value);
  expect(mock.readLayout).toHaveBeenCalledExactlyOnceWith("u", "artifact", 7, { db: value.db, store: value.store });
  expect(value.state.row.status).toBe("succeeded");
  expect(value.store.put.mock.calls[0][0]).toMatch(/\.svg$/);
  expect(value.store.put.mock.calls[0][2]).toBe("image/svg+xml");
  const invalid = fixture({ format: "svg", exporterVersion: exportFormat("svg").version });
  await executeArtifactExport("export", invalid);
  expect(invalid.state.row.errorCode).toBe("EXPORT_RESULT_INVALID");
  expect(invalid.store.put).not.toHaveBeenCalled();
});

it("enforces transient backoff at claim even on duplicate wakes and recovery does not postpone the due task", async () => {
  const value = fixture();
  value.render.mockRejectedValueOnce(new AppError("EXPORT_RENDER_FAILED", 422));
  await executeArtifactExport("export", value);
  expect(value.state.row).toMatchObject({ status: "queued", attempt: 1, errorCode: "EXPORT_RENDER_FAILED" });
  expect(+value.state.row.nextCheckAt).toBe(origin + 30000);
  await executeArtifactExport("export", value); await executeArtifactExport("export", value);
  expect(value.render).toHaveBeenCalledOnce(); expect(value.state.row.attempt).toBe(1);
  expect(await recoverArtifactExports({ db: value.db })).toBe(0);
  vi.setSystemTime(origin + 30000);
  expect(await recoverArtifactExports({ db: value.db })).toBe(1);
  expect(value.state.row.nextCheckAt <= new Date()).toBe(true);
  await executeArtifactExport("export", value);
  expect(value.state.row).toMatchObject({ status: "succeeded", attempt: 2 });
  expect(value.render).toHaveBeenCalledTimes(2);
});

it("rechecks eligibility inside the user transaction and preserves a live conversion lease", async () => {
  const value = fixture();
  const find = value.db.artifactExport.findUnique.getMockImplementation();
  value.db.artifactExport.findUnique.mockImplementationOnce(async args => {
    const old = await find(args);
    value.state.row.nextCheckAt = new Date(origin + 30000);
    return old;
  });
  await executeArtifactExport("export", value);
  expect(value.render).not.toHaveBeenCalled(); expect(value.state.row.attempt).toBe(0);
  value.state.row.status = "running"; value.state.row.leaseUntil = new Date(origin + 60000);
  await executeArtifactExport("export", value);
  expect(value.render).not.toHaveBeenCalled();
  value.state.row.leaseUntil = new Date(origin - 1);
  await executeArtifactExport("export", value);
  expect(value.state.row.status).toBe("succeeded");
});

it("bounds automatic retries and expires a backoff task without rendering beyond its deadline", async () => {
  const value = fixture(); value.render.mockRejectedValue(new AppError("EXPORT_RENDER_FAILED", 422));
  for (let attempt = 0; attempt < 4; attempt++) {
    vi.setSystemTime(origin + attempt * 30000);
    await executeArtifactExport("export", value);
  }
  expect(value.render).toHaveBeenCalledTimes(3);
  expect(value.state.row).toMatchObject({ status: "failed", attempt: 3 });
  const expired = fixture({ deadlineAt: new Date(origin), nextCheckAt: new Date(origin + 360000) });
  await executeArtifactExport("export", expired);
  expect(expired.render).not.toHaveBeenCalled();
  expect(expired.state.row).toMatchObject({ status: "failed", errorCode: "EXPORT_DEADLINE_EXCEEDED" });
});

it("keeps cancellation authoritative and refuses unsupported source/result without publishing a blob", async () => {
  const value = fixture(); value.render.mockImplementation(async () => { value.state.row.status = "cancelled"; return bytes; });
  await executeArtifactExport("export", value);
  expect(value.state.row).toMatchObject({ status: "cancelled" });
  expect(value.state.row.blobId).toBeUndefined(); expect(value.db.creationBlob.updateMany).not.toHaveBeenCalled();
  const invalid = fixture(); invalid.render.mockResolvedValue(Buffer.from("not a zip"));
  await executeArtifactExport("export", invalid);
  expect(invalid.state.row).toMatchObject({ status: "failed", errorCode: "EXPORT_RESULT_INVALID" });
  expect(invalid.store.put).not.toHaveBeenCalled();
  const wrong = fixture(); mock.readLayout.mockResolvedValue({ id: "artifact", content: { ...content(), kind: "poster" } });
  await executeArtifactExport("export", wrong);
  expect(wrong.state.row).toMatchObject({ status: "failed", errorCode: "EXPORT_KIND_UNSUPPORTED" });
  expect(wrong.render).not.toHaveBeenCalled();
});
