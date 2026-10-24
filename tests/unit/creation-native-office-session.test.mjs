import { beforeEach, expect, it, vi } from "vitest";
import { createNativeOfficeSession } from "../../src/lib/creation/client/native-office-session.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
const mocks = vi.hoisted(() => ({ read: vi.fn(), readInput: vi.fn(), writeInput: vi.fn(), write: vi.fn(), api: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../src/lib/client-api.js", () => ({ api: (...args) => mocks.api(...args), requestKey: () => "session-save-key-12345" }));
vi.mock("../../src/lib/creation/client/drafts.js", () => ({ readArtifactDraft: (...args) => mocks.read(...args), writeArtifactDraft: (...args) => mocks.write(...args), readArtifactTextDraft: (...args) => mocks.readInput(...args), writeArtifactTextDraft: (...args) => mocks.writeInput(...args) }));
vi.mock("../../src/lib/studio/project-list.js", () => ({ invalidateProjectLists: (...args) => mocks.invalidate(...args) }));
const content = value => toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Costs", sheets: [{ id: "s", name: "Costs", cells: [{ id: "c", address: "A1", value }] }] }, "unit");
const options = { userId: "u", artifactId: "a/b", draftSessionId: "browser-session-12345" };

it("isolates small input backups in the same user, artifact and browser draft branch", async () => {
  const session = createNativeOfficeSession(options), prepare = vi.fn();
  await session.readInputDraft(); await session.writeInputDraft({ format: "test" }, prepare);
  expect(mocks.readInput).toHaveBeenCalledWith("u", "a/b", options.draftSessionId);
  expect(mocks.writeInput).toHaveBeenCalledWith("u", "a/b", { format: "test" }, prepare, options.draftSessionId);
  expect(mocks.api).not.toHaveBeenCalled(); session.dispose();
});
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); mocks.read.mockResolvedValue(null); mocks.write.mockResolvedValue(); mocks.api.mockImplementation(async (_path, opts) => opts.method === "PUT" ? { artifactId: "a/b", revision: 2, baseRevision: 1 } : { id: "a/b", revision: 1, content: content(1) }); });

it("connects native HTTP saves with the same user/artifact/draft branch and a bounded request", async () => {
  const session = createNativeOfficeSession(options); await session.open(); session.change(content(2)); await session.flush();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("u", "a/b", options.draftSessionId);
  expect(mocks.write.mock.calls.every(([user, id, , branch]) => user === "u" && id === "a/b" && branch === options.draftSessionId)).toBe(true);
  const call = mocks.api.mock.calls.find(([, opts]) => opts.method === "PUT");
  expect(call[0]).toBe("/api/creation/artifacts/a%2Fb/native");
  expect(call[1]).toMatchObject({ method: "PUT", timeoutMs: 30000, body: { saveKey: "session-save-key-12345", baseRevision: 1 } });
  expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith("u");
  session.dispose(); expect(call[1].signal.aborted).toBe(true);
});

it("reserves local persistence immediately, before a remount can start reading the same draft branch", async () => {
  const session = createNativeOfficeSession(options); await session.open(); session.change(content(2));
  mocks.write.mockClear();
  const pending = session.persist();
  expect(mocks.write).toHaveBeenCalledOnce(); // no private microtask queue before IndexedDB's key queue
  session.dispose(); await pending;
  expect(() => createNativeOfficeSession({ ...options, draftSessionId: undefined })).toThrow("LOCAL_DRAFT_SESSION_INVALID");
});

it("aborts stale sessions and never sends a save when their parent lifetime already ended", async () => {
  const parent = new AbortController(), session = createNativeOfficeSession({ ...options, signal: parent.signal });
  await session.open(); session.change(content(2)); parent.abort();
  expect(() => session.flush()).toThrow("ARTIFACT_CLOSED");
  expect(mocks.api.mock.calls.some(([, opts]) => opts.method === "PUT")).toBe(false);
  session.dispose();
});
