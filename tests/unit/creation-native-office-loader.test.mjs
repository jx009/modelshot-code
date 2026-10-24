// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ sheet: vi.fn(), document: vi.fn() }));
vi.mock("../../src/lib/creation/client/univer-sheets-runtime.js", async () => state.sheet());
vi.mock("../../src/lib/creation/client/univer-docs-runtime.js", async () => state.document());
beforeEach(() => { vi.resetModules(); state.sheet.mockReset(); state.document.mockReset(); });

it("imports only the selected editor, shares module loads and never mounts during preload", async () => {
  const { loadNativeOfficeRuntime } = await import("../../src/lib/creation/client/native-office-loader.js");
  expect(state.sheet).not.toHaveBeenCalled(); expect(state.document).not.toHaveBeenCalled();
  const mount = vi.fn(); state.sheet.mockResolvedValue({ mount });
  const [first, second] = await Promise.all([loadNativeOfficeRuntime("sheet"), loadNativeOfficeRuntime("sheet")]);
  expect(first).toBe(second); expect(state.sheet).toHaveBeenCalledOnce(); expect(state.document).not.toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
  await expect(loadNativeOfficeRuntime("poster")).rejects.toThrow("ARTIFACT_KIND_MISMATCH");
});

it("lets a current mount reuse an import while cancelling an obsolete mount before runtime delivery", async () => {
  const { loadNativeOfficeRuntime } = await import("../../src/lib/creation/client/native-office-loader.js");
  let resolve;
  state.document.mockImplementation(() => new Promise(done => { resolve = done; }));
  const controller = new AbortController(), old = loadNativeOfficeRuntime("document", { signal: controller.signal });
  const current = loadNativeOfficeRuntime("document");
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  const rejected = expect(old).rejects.toThrow("closed");
  controller.abort(new Error("closed")); resolve({ mount: vi.fn() });
  await rejected; expect((await current).mount).toBeTypeOf("function");
  expect(state.document).toHaveBeenCalledOnce(); expect(state.sheet).not.toHaveBeenCalled();
});
