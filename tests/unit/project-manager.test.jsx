// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ProjectManager from "../../src/components/studio/ProjectManager.jsx";
import { invalidateProjectLists } from "../../src/lib/studio/project-list.js";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock("@/components/ui/Modal", () => ({ default: ({ children, label }) => <section role="dialog" aria-label={label}>{children}</section> }));
beforeEach(() => { mocks.api.mockReset(); invalidateProjectLists("manager-user"); });
afterEach(cleanup);
const props = { userId: "manager-user", locale: "zh", draft: { name: "当前项目" }, ready: true, update: vi.fn(), save: vi.fn(), onChoose: vi.fn(), onClose: vi.fn(), onError: vi.fn() };

test("project manager is visible and closeable before the list request completes", async () => {
  let finish;
  mocks.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const onClose = vi.fn();
  render(<ProjectManager {...props} onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "项目管理" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("正在加载项目");
  fireEvent.click(screen.getByTitle("关闭"));
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => finish({ items: [], nextCursor: null }));
});

test("closing the manager cancels its otherwise unshared list request", () => {
  let signal;
  mocks.api.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const view = render(<ProjectManager {...props} />);
  view.unmount();
  expect(signal.aborted).toBe(true);
});

test("list failures offer retry inside the already open manager", async () => {
  mocks.api.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValueOnce({ items: [], nextCursor: null });
  render(<ProjectManager {...props} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(await screen.findByText("还没有云端项目。保存你的第一个作品。")).toBeTruthy();
});
