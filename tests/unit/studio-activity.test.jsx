// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StudioActivity from "../../src/components/studio/StudioActivity.jsx";
afterEach(cleanup);
const job = { id: "old-job", tool: "inpaint", status: "running", createdAt: "2020-01-01T00:00:00Z" };
const props = { resultStates: {}, onCancel: vi.fn(), onRetry: vi.fn(), zh: true };
it("replaces an observed running task with a failure even when it predates opening the canvas", () => {
  const { rerender, container } = render(<StudioActivity {...props} jobs={[job]} />);
  expect(screen.getByRole("status").textContent).toContain("正在处理");
  rerender(<StudioActivity {...props} jobs={[{ ...job, status: "failed", errorCode: "PROVIDER_RESULT_UNAVAILABLE: HTTP 524: timeout" }]} />);
  expect(screen.getByRole("status").textContent).toContain("上游连接超时");
  expect(screen.getByRole("status").textContent).toContain("本次不扣积分");
  expect(container.querySelector(".ms-spin")).toBeNull();
  expect(screen.queryByText("取消")).toBeNull();
  expect(screen.getByLabelText("关闭失败提示")).toBeTruthy();
});
it("distinguishes interrupted reconciliation and real asynchronous polling from processing", () => {
  const { rerender } = render(<StudioActivity {...props} jobs={[{ ...job, status: "reconciling", errorCode: "PROVIDER_RESULT_UNKNOWN: HTTP 524" }]} />);
  expect(screen.getByRole("status").textContent).toContain("连接中断，正在核对结果");
  expect(screen.getByRole("status").textContent).not.toContain("正在处理");
  rerender(<StudioActivity {...props} jobs={[{ ...job, tool: "video", status: "reconciling", errorCode: "PROVIDER_PENDING" }]} />);
  expect(screen.getByRole("status").textContent).toContain("正在查询生成结果");
});
