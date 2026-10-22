import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readImageCapabilities, setImageCapabilitiesUser } from "../../src/lib/studio/image-capabilities-client.js";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api.js", () => ({ api: mocks.api }));
const data = { imageProvider: "image-model", imageModels: [{ id: "image-model", label: "Image" }], tools: [] };
beforeEach(() => setImageCapabilitiesUser("user-a"));
afterEach(() => { setImageCapabilitiesUser(null); mocks.api.mockReset(); vi.restoreAllMocks(); });

it("shares in-flight reads and reuses default and selected model entries", async () => {
  let resolve;
  mocks.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = readImageCapabilities("user-a"), second = readImageCapabilities("user-a");
  expect(first).toBe(second);
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/studio/capabilities?scope=images", expect.any(Object));
  resolve(data);
  expect(await first).toEqual(data);
  expect(await readImageCapabilities("user-a", "image-model")).toEqual(data);
  expect(mocks.api).toHaveBeenCalledOnce();
});

it("refreshes after sixty seconds and isolates users", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  mocks.api.mockResolvedValue(data);
  await readImageCapabilities("user-a");
  clock.mockReturnValue(61001);
  await readImageCapabilities("user-a");
  await readImageCapabilities("user-a", "image-model");
  expect(mocks.api).toHaveBeenCalledTimes(2);
  setImageCapabilitiesUser("user-b");
  await readImageCapabilities("user-b");
  expect(mocks.api).toHaveBeenCalledTimes(3);
});

it("does not reuse another provider's capabilities", async () => {
  mocks.api.mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, imageProvider: "other-model" });
  await readImageCapabilities("user-a");
  const other = await readImageCapabilities("user-a", "other-model");
  expect(other.imageProvider).toBe("other-model");
  expect(mocks.api.mock.calls[1][0]).toBe("/api/studio/capabilities?scope=images&imageProvider=other-model");
});

it("discards a response that arrives after logout", async () => {
  let resolve;
  mocks.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = readImageCapabilities("user-a");
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  setImageCapabilitiesUser(null);
  expect(mocks.api.mock.calls[0][1].signal.aborted).toBe(true);
  resolve(data);
  await rejected;
  await expect(readImageCapabilities("user-a")).rejects.toMatchObject({ status: 401 });
  expect(mocks.api).toHaveBeenCalledOnce();
});

it("does not cache a failed read", async () => {
  mocks.api.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(data);
  await expect(readImageCapabilities("user-a")).rejects.toThrow("offline");
  expect(await readImageCapabilities("user-a")).toEqual(data);
  expect(mocks.api).toHaveBeenCalledTimes(2);
});
