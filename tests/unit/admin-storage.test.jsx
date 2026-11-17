// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StorageSettings from "../../src/components/admin/StorageSettings.jsx";
vi.mock("../../src/hooks/useAdminReason", () => ({ useAdminReason: () => ({ ask: async () => ({ key: "fixture-admin-cos-action", reason: "Configure private delivery" }), dialog: null }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const config = { enabled: false, bucket: "fixture-1250000000", region: "ap-hongkong", prefix: "letaidraw", signedUrlSeconds: 300, credentialsConfigured: true, endpoint: "https://fixture.example.com" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("saves edited COS settings with blank credentials preserved and an idempotency key", async () => {
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method ? { ok: true } : { config, canManage: true, mirrored: 12 } }));
  vi.stubGlobal("fetch", fetch);
  render(<StorageSettings />);
  fireEvent.click(await screen.findByLabelText("启用 COS 长期存储与加速"));
  expect(screen.getByLabelText(/^SecretKey/).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  const [, init] = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(init.body).config).toEqual({ enabled: true, directUploadEnabled: false, bucket: config.bucket, region: "ap-hongkong", prefix: "letaidraw", signedUrlSeconds: 300, secretId: "", secretKey: "" });
  expect(init.headers["Idempotency-Key"]).toBe("fixture-admin-cos-action");
});
it("allows ordinary admins to inspect but disables credential changes and tests", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ config, canManage: false, mirrored: 0 }) })));
  render(<StorageSettings />);
  expect((await screen.findByRole("button", { name: "保存配置" })).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "测试连接与跨域" }).disabled).toBe(true);
  expect(screen.getByLabelText("启用 COS 长期存储与加速").disabled).toBe(true);
  expect(screen.getByRole("switch", { name: "浏览器直传 COS（PUT）" }).disabled).toBe(true);
});

const probe = { url: "https://fixture.example.com/probe?put-signature", headers: { "Content-Type": "image/png" }, bodyBase64: "AQID" };
function mockProbeFetch(put) {
  const fetch = vi.fn(async (url, init) => {
    if (url === probe.url) return put(init);
    return { ok: true, json: async () => init?.method === "POST"
      ? { ok: true, probeUrl: "https://fixture.example.com/probe?get-signature", uploadProbe: probe }
      : { config: { ...config, enabled: true, directUploadEnabled: true }, canManage: true, mirrored: 0 } };
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("does not report success when server checks pass but browser PUT is blocked", async () => {
  const fetch = mockProbeFetch(() => { throw new TypeError("Failed to fetch"); });
  const image = vi.fn(); vi.stubGlobal("Image", image);
  render(<StorageSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "测试连接与跨域" }));
  expect((await screen.findByRole("alert")).textContent).toContain("浏览器 PUT 上传检查失败");
  expect(screen.getByRole("alert").textContent).toContain("Content-Type");
  expect(screen.queryByRole("status")).toBeNull();
  expect(image).not.toHaveBeenCalled();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});
it("requires the browser signed PUT and canvas read to pass before reporting success", async () => {
  const fetch = mockProbeFetch(() => ({ ok: true }));
  vi.stubGlobal("Image", class { set src(value) { if (value) queueMicrotask(() => this.onload()); } });
  const getImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData });
  render(<StorageSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "测试连接与跨域" }));
  expect((await screen.findByRole("status")).textContent).toContain("浏览器 PUT 直传和画布跨域检查全部通过");
  const [, init] = fetch.mock.calls.find(([url]) => url === probe.url);
  expect(init).toMatchObject({ method: "PUT", credentials: "omit", headers: probe.headers });
  expect(Array.from(init.body)).toEqual([1, 2, 3]);
  expect(getImageData).toHaveBeenCalled();
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
});
it("refuses to report a complete test for an outdated server without a PUT probe", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method === "POST"
    ? { ok: true, probeUrl: "https://fixture.example.com/probe" } : { config: { ...config, enabled: true, directUploadEnabled: true }, canManage: true, mirrored: 0 } })));
  render(<StorageSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "测试连接与跨域" }));
  expect((await screen.findByRole("alert")).textContent).toContain("上传测试响应不完整");
  expect(screen.queryByRole("status")).toBeNull();
});
it("defaults existing configurations to server upload and saves an explicit opt-in", async () => {
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method ? { ok: true } : { config: { ...config, enabled: true }, canManage: true, mirrored: 12 } }));
  vi.stubGlobal("fetch", fetch);
  render(<StorageSettings />);
  const toggle = await screen.findByRole("switch", { name: "浏览器直传 COS（PUT）" });
  expect(toggle.checked).toBe(false);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  const [, init] = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(init.body).config).toMatchObject({ enabled: true, directUploadEnabled: true });
});
it("checks reading without a browser PUT when direct upload is off", async () => {
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method === "POST"
    ? { ok: true, probeUrl: "https://fixture.example.com/probe" } : { config: { ...config, enabled: true, directUploadEnabled: false }, canManage: true, mirrored: 0 } }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Image", class { set src(value) { if (value) queueMicrotask(() => this.onload()); } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn() });
  render(<StorageSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "测试连接与跨域" }));
  expect((await screen.findByRole("status")).textContent).toContain("无需浏览器 PUT 权限");
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("starts a bucket migration from the admin page and shows its progress", async () => {
  const running = { active: true, status: "running", phase: "copy", source: { bucket: config.bucket }, target: { bucket: "next-1250000000", region: "ap-guangzhou" }, copied: 4, estimate: 10, percent: 40 };
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method === "PUT" ? { migration: running } : { config: { ...config, enabled: true }, canManage: true, mirrored: 3, migration: { active: false } } }));
  vi.stubGlobal("fetch", fetch);
  render(<StorageSettings />);
  fireEvent.change(await screen.findByLabelText(/^新存储桶名称/), { target: { value: "next-1250000000" } });
  fireEvent.change(screen.getByLabelText(/^新桶地域/), { target: { value: "ap-guangzhou" } });
  fireEvent.click(screen.getByRole("button", { name: "开始迁移并切换" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  const [, init] = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(JSON.parse(init.body)).toEqual({ action: "start", bucket: "next-1250000000", region: "ap-guangzhou", reason: "Configure private delivery" });
  expect(await screen.findByText("迁移中 40%")).toBeTruthy();
  expect(screen.getByRole("button", { name: "取消迁移" })).toBeTruthy();
});
