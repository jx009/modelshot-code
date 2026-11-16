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
const props = { userId: "manager-user", locale: "zh", ready: true, editor: { draft: { name: "当前项目" }, update: vi.fn(), save: vi.fn(), onError: vi.fn() }, onChoose: vi.fn(), onClose: vi.fn() };

test("project manager is visible and closeable before the list request completes", async () => {
  let finish;
  mocks.api.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const onClose = vi.fn();
  render(<ProjectManager {...props} onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "我的项目" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "正在加载项目" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
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
  expect(await screen.findByText("还没有项目，开始你的第一个创作吧")).toBeTruthy();
});

test("lists only the requested kinds, marks the current project and searches by name", async () => {
  mocks.api.mockImplementation(url => Promise.resolve({ items: url.includes("q=") ? [] : [{ id: "a", name: "单镜头作品", kind: "video", updatedAt: new Date().toISOString(), coverAssetId: null, count: 1 }, { id: "b", name: "分镜作品", kind: "motion", updatedAt: new Date().toISOString(), coverAssetId: null, count: 4 }], nextCursor: null }));
  const onChoose = vi.fn();
  render(<ProjectManager {...props} editor={undefined} kinds={["video", "motion"]} currentId="a" onChoose={onChoose} />);
  expect(await screen.findByText("分镜作品")).toBeTruthy();
  expect(mocks.api.mock.calls[0][0]).toContain("kind=video%2Cmotion");
  expect(screen.getByText("单镜头作品").closest("button").disabled).toBe(true);
  fireEvent.click(screen.getByText("分镜作品").closest("button"));
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  fireEvent.change(screen.getByLabelText("搜索项目"), { target: { value: "不存在" } });
  expect(await screen.findByText("没有找到匹配的项目")).toBeTruthy();
});
