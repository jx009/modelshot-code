// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdminTryons from "../../src/app/[locale]/admin/tryons/page.js";
import { useRemoteResource } from "../../src/hooks/useRemoteResource.js";

vi.mock("../../src/hooks/useRemoteResource.js", () => ({ useRemoteResource: vi.fn() }));
vi.mock("../../src/hooks/useAdminReason.js", () => ({ useAdminReason: () => ({ ask: vi.fn(), dialog: null }) }));
const prompt = "完整提示词".repeat(100);
const row = { id: "job-123", tool: "ocr", toolLabel: "文字识别", status: "failed", userEmail: "creator@example.com", createTime: new Date().toISOString(), errorCode: "OCR_FAILED", inputs: [], outputs: [] };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function () { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function () { this.open = false; });
  useRemoteResource.mockImplementation(url => ({ data: url.startsWith("/api/admin/tryons?")
    ? { tryons: [row], total: 1, page: 1, limit: 20, statusCounts: [] }
    : { ...row, prompt, userPrompt: prompt, inputs: [{ id: "source", label: "原始输入图", url: "/api/admin/assets/source", contentType: "image/png" }],
      resultData: { text: "这是一段识别出的文字" }, params: { scale: 4 }, attempts: [{ errorCode: "OCR_FAILED" }] }, reload: vi.fn() }));
});
afterEach(cleanup);

it("opens failed text-only jobs, full prompts, input images and OCR text, and closes via the header", () => {
  render(<AdminTryons />);
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(useRemoteResource).toHaveBeenCalledWith("/api/admin/tryons/job-123");
  expect(screen.getByRole("dialog", { name: "生成任务审计详情" })).toBeTruthy();
  expect(screen.getByText(prompt)).toBeTruthy();
  expect(screen.getByText("这是一段识别出的文字")).toBeTruthy();
  expect(screen.getByAltText("原始输入图").getAttribute("src")).toBe("/api/admin/assets/source");
  expect(screen.getByText("生成参数")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭审计详情" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("provides a retry when detail loading fails instead of showing another task", () => {
  const reload = vi.fn();
  useRemoteResource.mockImplementation(url => url.includes("?")
    ? { data: { tryons: [row], total: 1, limit: 20, statusCounts: [] } }
    : { data: null, error: new Error("denied"), reload });
  render(<AdminTryons />);
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  expect(screen.getByRole("alert").textContent).toContain("详情加载失败");
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(reload).toHaveBeenCalledOnce();
  expect(screen.queryByText(prompt)).toBeNull();
});

it("copies the complete prompt using selection on HTTP deployments", () => {
  const copy = vi.fn().mockReturnValue(true);
  const old = document.execCommand;
  document.execCommand = copy;
  try {
    render(<AdminTryons />);
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    fireEvent.click(screen.getAllByRole("button", { name: "复制", exact: true })[0]);
    expect(copy).toHaveBeenCalledWith("copy");
    expect(window.getSelection().toString()).toBe(prompt);
    expect(screen.getByRole("button", { name: "已复制", exact: true })).toBeTruthy();
  } finally { document.execCommand = old; }
});
