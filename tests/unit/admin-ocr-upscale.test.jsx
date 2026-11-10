// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AdminProviders from "../../src/app/[locale]/admin/providers/page.js";

vi.mock("../../src/hooks/useAdminReason", () => ({ useAdminReason: () => ({ ask: async () => ({ key: "fixture-admin-action", reason: "Configure image tools" }), dialog: null }) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

it.each(["ocr", "upscale"])("creates an independently configured %s channel through the admin form", async purpose => {
  window.history.replaceState({}, "", `/?category=tool&purpose=${purpose}`);
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method && init.method !== "GET" ? { ok: true } : [] }));
  vi.stubGlobal("fetch", fetch);
  render(<AdminProviders />);
  const selector = await screen.findByLabelText("用途");
  expect(selector.value).toBe(purpose);
  if (purpose === "ocr") {
    fireEvent.change(screen.getByLabelText("OCR 视觉模型 ID / Endpoint ID"), { target: { value: "ep-ocr-test" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-ocr-key" } });
  } else {
    expect(screen.queryByLabelText("API Key")).toBeNull();
    expect(screen.getByLabelText("超分算法（固定）").readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText("Access Key ID (AK)"), { target: { value: "fixture-ak" } });
    fireEvent.change(screen.getByLabelText("Secret Access Key (SK)"), { target: { value: "fixture-sk" } });
  }
  fireEvent.click(screen.getByRole("button", { name: "保存新模型" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  const body = JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "PUT")[1].body);
  expect(body).toMatchObject({ scope: "tool", studioCapability: purpose, kind: purpose === "ocr" ? "volcengine" : "volc-visual", model: purpose === "ocr" ? "ep-ocr-test" : "lens_vida_nnsr" });
  expect(body.isPlanner).toBeUndefined();
  await screen.findByRole("button", { name: "新增模型" });
});

it("can change an existing Ark channel's purpose to OCR without setting it as planner", async () => {
  window.history.replaceState({}, "", "/?category=language");
  const provider = { id: "existing", name: "ark", kind: "volcengine", displayName: "Existing visual model", isPlanner: true, isActive: true, creditCost: 1, costPerImage: 0, priority: 1, config: { scope: "language", studioCapability: "language", model: "ep-existing", hasKey: true, keyMasked: "***" } };
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method && init.method !== "GET" ? { ok: true } : [provider] }));
  vi.stubGlobal("fetch", fetch);
  render(<AdminProviders />);
  fireEvent.change(await screen.findByLabelText("用途"), { target: { value: "ocr" } });
  fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  const body = JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "PATCH")[1].body);
  expect(body).toMatchObject({ scope: "tool", studioCapability: "ocr", isPlanner: false });
  expect(body.apiKey).toBeUndefined();
});

it("switches OCR to OpenAI compatible and saves the custom gateway without changing its purpose", async () => {
  window.history.replaceState({}, "", "/?category=tool&purpose=ocr");
  const fetch = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method && init.method !== "GET" ? { ok: true } : [] }));
  vi.stubGlobal("fetch", fetch);
  render(<AdminProviders />);
  fireEvent.change(await screen.findByLabelText("协议类型"), { target: { value: "openai" } });
  expect(screen.getByLabelText("用途").value).toBe("ocr");
  expect(screen.getByLabelText("Base URL").value).toBe("https://api.openai.com/v1");
  fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://gateway.example.com/v1" } });
  fireEvent.change(screen.getByLabelText("OCR 视觉模型 ID / Endpoint ID"), { target: { value: "my-vision-model" } });
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-key" } });
  fireEvent.click(screen.getByRole("button", { name: "保存新模型" }));
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  const body = JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "PUT")[1].body);
  expect(body).toMatchObject({ kind: "openai", scope: "tool", studioCapability: "ocr", model: "my-vision-model", baseURL: "https://gateway.example.com/v1" });
});
