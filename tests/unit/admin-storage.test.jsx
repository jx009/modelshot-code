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
  fireEvent.click(await screen.findByLabelText("启用图片加速"));
  expect(screen.getByLabelText(/^SecretKey/).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  const [, init] = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(init.body).config).toEqual({ enabled: true, bucket: config.bucket, region: "ap-hongkong", prefix: "letaidraw", signedUrlSeconds: 300, secretId: "", secretKey: "" });
  expect(init.headers["Idempotency-Key"]).toBe("fixture-admin-cos-action");
});
it("allows ordinary admins to inspect but disables credential changes and tests", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ config, canManage: false, mirrored: 0 }) })));
  render(<StorageSettings />);
  expect((await screen.findByRole("button", { name: "保存配置" })).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "测试连接与跨域" }).disabled).toBe(true);
  expect(screen.getByLabelText("启用图片加速").disabled).toBe(true);
});
