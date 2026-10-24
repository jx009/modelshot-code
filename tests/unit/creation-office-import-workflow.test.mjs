import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { executeOfficeImport, cancelOfficeImport, recoverOfficeImports, requestOfficeImport } from "../../src/lib/domain/creation/office-imports.js";
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
vi.mock("../../src/lib/infra/storage/s3.js", () => ({ objectStorage: () => { throw new Error("No external storage"); } }));
vi.mock("../../src/lib/domain/creation/native-office-artifacts.js", () => ({ createNativeOfficeArtifact: (...args) => mock.create(...args) }));
beforeEach(() => { mock.create.mockReset(); });
function fixture() {
  const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0x04034b50);
  const row = { id: "import", userId: "u", projectId: "p", name: "预算.xlsx", format: "xlsx", status: "queued", attempt: 0,
    nextCheckAt: new Date(0), deadlineAt: new Date(Date.now() + 600000), sourceBlob: { id: "blob", userId: "u", state: "ready", objectKey: "original", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") }, project: { deletedAt: null } };
  const matches = where => (!where.status || (where.status.in ? where.status.in.includes(row.status) : where.status === row.status)) && (where.attempt === undefined || where.attempt === row.attempt)
    && (!where.leaseUntil || row.leaseUntil > where.leaseUntil.gt) && (!where.deadlineAt || row.deadlineAt > where.deadlineAt.gt);
  const update = data => { for (const [k,v] of Object.entries(data)) row[k] = v?.increment ? row[k] + v.increment : v; return structuredClone(row); };
  const db = {
    $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), user: { findUnique: vi.fn(async () => ({ id: "u", status: "active" })) },
    creationImport: { findUnique: vi.fn(async ({ where }) => where.projectId_importKey ? null : structuredClone(row)),
      findFirst: vi.fn(async ({ where }) => matches(where) ? structuredClone(row) : null), findMany: vi.fn(async () => [structuredClone(row)]),
      update: vi.fn(async ({ data }) => update(data)), updateMany: vi.fn(async ({ where, data }) => matches(where) ? (update(data), { count: 1 }) : { count: 0 }) },
    creationProject: { findFirst: vi.fn(async () => ({ id: "p", kind: "sheet" })) },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
    serviceHeartbeat: { findUnique: vi.fn(async () => null) }, asset: { upsert: vi.fn() },
  };
  db.$transaction = async fn => fn(db);
  const content = { snapshot: { id: "office-import", custom: { modelshot: { officeImport: { sourceId: "import", format: "xlsx", warnings: [], protection: {} } } } } };
  const parse = vi.fn(async () => ({ content, media: [] })), store = { get: vi.fn(async () => bytes), put: vi.fn() };
  mock.create.mockImplementation(async (...args) => { const { hooks } = args[4]; await hooks.beforeStage(); await hooks.beforeCommit(db); await hooks.afterCommit(db, { artifactId: "artifact" }); return { artifactId: "artifact" }; });
  return { row, bytes, db, parse, store };
}
it("commits the import and artifact together; duplicate wakes do not parse or publish twice", async () => {
  const f = fixture();
  await executeOfficeImport("import", f);
  expect(f.row).toMatchObject({ status: "succeeded", artifactId: "artifact", attempt: 1, leaseUntil: null });
  await executeOfficeImport("import", f);
  expect(f.parse).toHaveBeenCalledOnce(); expect(mock.create).toHaveBeenCalledOnce();
});
it("prevents a late parser result from publishing after cancellation", async () => {
  const f = fixture(), parse = f.parse.getMockImplementation();
  f.parse.mockImplementation(async (...args) => { await cancelOfficeImport("u", "import", f.db); return parse(...args); });
  await executeOfficeImport("import", f);
  expect(f.row.status).toBe("cancelled"); expect(mock.create).not.toHaveBeenCalled();
});
it("honors leases and backoff, and rejects corrupt originals before parsing", async () => {
  const f = fixture(); f.row.status = "running"; f.row.leaseUntil = new Date(Date.now() + 60000);
  await executeOfficeImport("import", f); expect(f.parse).not.toHaveBeenCalled();
  f.row.status = "queued"; f.row.nextCheckAt = new Date(Date.now() + 60000);
  await executeOfficeImport("import", f); expect(f.parse).not.toHaveBeenCalled();
  f.row.nextCheckAt = new Date(0); f.store.get.mockResolvedValue(Buffer.from("broken"));
  await executeOfficeImport("import", f);
  expect(f.row).toMatchObject({ status: "failed", errorCode: "OFFICE_SOURCE_INVALID" });
});
it("limits retries and rotates recovered work without postponing a queued wake", async () => {
  const f = fixture(); f.parse.mockRejectedValue(new Error("temporary"));
  await executeOfficeImport("import", f);
  expect(f.row).toMatchObject({ status: "queued", attempt: 1 });
  const now = new Date(Date.now() + 31000);
  await recoverOfficeImports({ db: f.db, now });
  expect(f.row.nextCheckAt).toEqual(now);
  expect(f.db.outboxEvent.upsert).toHaveBeenCalledOnce();
  f.row.attempt = 3; f.row.nextCheckAt = new Date(0);
  await executeOfficeImport("import", f);
  expect(f.row.status).toBe("failed"); expect(f.parse).toHaveBeenCalledOnce();
});
it("rejects unavailable workers and replays an existing upload before checking availability", async () => {
  const f = fixture(), file = { name: "预算.xlsx", size: f.bytes.length, arrayBuffer: async () => f.bytes };
  await expect(requestOfficeImport("u", "p", file, "upload-key-123456", { ...f, env: {} })).rejects.toThrow("OFFICE_WORKER_UNAVAILABLE");
  f.db.creationImport.findUnique.mockResolvedValue(f.row);
  expect(await requestOfficeImport("u", "p", file, "upload-key-123456", { ...f, env: {} })).toMatchObject({ id: "import" });
  f.row.sourceBlob.checksum = "different";
  await expect(requestOfficeImport("u", "p", file, "upload-key-123456", f)).rejects.toThrow("SAVE_KEY_REUSED");
});
