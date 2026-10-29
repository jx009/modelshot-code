// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AdminProviders from "../../src/app/[locale]/admin/providers/page.js";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
vi.mock("@/hooks/useAdminReason", () => ({ useAdminReason: () => ({ ask: vi.fn(), dialog: null }) }));
beforeEach(() => { mocks.api.mockReset(); window.history.replaceState(null, "", "/zh/admin/providers"); });
afterEach(cleanup);

test("model configuration reads have a deadline and an explicit retry after failure", async () => {
  mocks.api.mockRejectedValueOnce(Object.assign(new Error("REQUEST_TIMEOUT"), { code: "REQUEST_TIMEOUT" })).mockResolvedValueOnce([]);
  render(<AdminProviders />);
  expect(screen.getByRole("status").textContent).toContain("加载模型配置");
  expect((await screen.findByRole("alert")).textContent).toContain("超时");
  expect(mocks.api).toHaveBeenCalledWith("/api/admin/providers", expect.objectContaining({ timeoutMs: 15000, signal: expect.any(AbortSignal) }));
  fireEvent.click(screen.getByRole("button", { name: "重新加载模型配置" }));
  expect(await screen.findByRole("heading", { name: "模型配置" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("leaving cancels the model read and ignores its late response", async () => {
  let complete;
  mocks.api.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<AdminProviders />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  const signal = mocks.api.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => complete([]));
  expect(screen.queryByRole("heading", { name: "模型配置" })).toBeNull();
});

test("invalid model responses show an error rather than an empty success screen", async () => {
  mocks.api.mockResolvedValue({});
  render(<AdminProviders />);
  expect((await screen.findByRole("alert")).textContent).toContain("加载模型配置失败");
  expect(screen.queryByRole("button", { name: "新增模型" })).toBeNull();
});

test("separates video models from image models and creates supported video configurations", async () => {
  mocks.api.mockResolvedValue([{ id: "video-provider", name: "video-channel", kind: "volcengine", displayName: "My video model", creditCost: 24, costPerImage: 0, isActive: true, priority: 1, config: { scope: "public", studioCapability: "video", model: "endpoint-video", hasKey: true, studioDefault: true } }]);
  render(<AdminProviders />);
  await screen.findByRole("heading", { name: "模型配置" });
  expect(screen.queryByText("My video model")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "视频模型" }));
  expect(screen.getByText("My video model")).toBeTruthy();
  expect(screen.getByText("默认视频模型")).toBeTruthy();
  expect(screen.queryByText("测试功能（产生上游费用）")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新增模型" }));
  const protocol = screen.getByLabelText("视频接口协议");
  expect(protocol.value).toBe("volcengine");
  expect(protocol.disabled).toBe(false);
  fireEvent.change(protocol, { target: { value: "openai" } });
  expect(protocol.value).toBe("openai");
  expect(screen.getByLabelText("Base URL").value).toBe("");
  expect(screen.getAllByLabelText("4 秒").length).toBeGreaterThan(0);
});

test("offers Ali, Volcengine and MiniMax image presets and native MiniMax defaults", async () => {
  mocks.api.mockResolvedValue([]);
  render(<AdminProviders />);
  fireEvent.click(await screen.findByRole("button", { name: "新增模型" }));
  expect(screen.getByRole("option", { name: "阿里百炼 · Qwen 生成与编辑" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "火山方舟 · Seedream" })).toBeTruthy();
  const preset = screen.getByRole("option", { name: "MiniMax · Image-01 文生图" });
  fireEvent.change(screen.getByLabelText("配置预设"), { target: { value: preset.value } });
  expect(screen.getByLabelText("协议类型").value).toBe("minimax");
  expect(screen.getByLabelText("模型名 / 火山 Endpoint ID").value).toBe("image-01");
  expect(screen.getByLabelText("Base URL").value).toBe("https://api.minimax.cn/v1");
  expect(screen.getByText(/MiniMax 当前接入 image-01 文生图/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("协议类型"), { target: { value: "openai" } });
  fireEvent.change(screen.getByLabelText("协议类型"), { target: { value: "minimax" } });
  expect(screen.getByLabelText("模型名 / 火山 Endpoint ID").value).toBe("image-01");
  expect(screen.getByLabelText("Base URL").value).toBe("https://api.minimax.cn/v1");
});

test("does not offer editing or language roles for MiniMax image channels", async () => {
  mocks.api.mockResolvedValue([{ id: "minimax", name: "minimax-image", kind: "minimax", displayName: "MiniMax", creditCost: 18, costPerImage: 0, isActive: true, priority: 1,
    config: { scope: "public", studioCapability: "image", imageMode: "generate", model: "image-01", hasKey: true } }]);
  render(<AdminProviders />);
  await screen.findByText("MiniMax");
  expect([...screen.getByLabelText("用途").options].map(option => option.value)).toEqual(["public"]);
});
