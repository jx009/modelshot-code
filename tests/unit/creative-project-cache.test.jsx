// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CreativeProjects from "../../src/components/discover/CreativeProjects.jsx";
import { invalidateProjectLists } from "../../src/lib/studio/project-list.js";

const mocks = vi.hoisted(() => ({ api: vi.fn(), session: null, serial: 0 }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
vi.mock("next-auth/react", () => ({ useSession: () => mocks.session }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock("@/components/studio/AssetImage", () => ({ default: () => null }));
vi.mock("@/components/ui/Modal", () => ({ default: ({ children, label }) => <section role="dialog" aria-label={label}>{children}</section> }));
const page = { items: [{ id: "project", name: "上次的项目", kind: "canvas", updatedAt: "2026-10-21T00:00:00Z" }], nextCursor: null };

beforeEach(() => {
  mocks.api.mockReset();
  mocks.session = { status: "authenticated", data: { user: { id: `user-${++mocks.serial}` } } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("revisiting a fresh project page reuses it without another request", async () => {
  mocks.api.mockResolvedValueOnce(page);
  const initial = render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  initial.unmount();
  const revisited = render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  revisited.unmount();
  invalidateProjectLists(mocks.session.data.user.id);
  let finish;
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CreativeProjects />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  await act(async () => finish({ ...page, items: [{ ...page.items[0], name: "新项目名称" }] }));
  expect(screen.queryByText("上次的项目")).toBeNull();
  expect(screen.getByText("新项目名称")).toBeTruthy();
});

test("switching accounts never shows another user's project snapshot", async () => {
  mocks.api.mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  mocks.session = { status: "authenticated", data: { user: { id: "another-user" } } };
  view.rerender(<CreativeProjects />);
  expect(screen.queryByText("上次的项目")).toBeNull();
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
});

test("expired project snapshots are not restored", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  mocks.api.mockResolvedValueOnce(page);
  const initial = render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  initial.unmount();
  clock.mockReturnValue(now + 31_000);
  mocks.api.mockImplementationOnce(() => new Promise(() => {}));
  render(<CreativeProjects />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("上次的项目")).toBeNull();
});

test("denied revalidation removes the visible snapshot and cached project page", async () => {
  mocks.api.mockResolvedValueOnce(page);
  const initial = render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  initial.unmount();
  invalidateProjectLists(mocks.session.data.user.id);
  const denied = Object.assign(new Error("Forbidden"), { status: 403 });
  mocks.api.mockRejectedValueOnce(denied);
  const revisited = render(<CreativeProjects />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("上次的项目")).toBeNull();
  revisited.unmount();
  mocks.api.mockImplementationOnce(() => new Promise(() => {}));
  render(<CreativeProjects />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
  expect(screen.queryByText("上次的项目")).toBeNull();
});

test("rename updates the card before the request completes and rolls back failure", async () => {
  let reject;
  mocks.api.mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(page);
  render(<CreativeProjects />);
  await screen.findByText("上次的项目");
  fireEvent.click(screen.getByRole("button", { name: "项目菜单：上次的项目" }));
  fireEvent.click(screen.getByRole("button", { name: "重命名" }));
  fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "立即更新名称" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByText("立即更新名称")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "项目名称" })).toBeNull();
  await act(async () => reject(new Error("保存失败")));
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("保存失败");
});

test("confirmed deletion hides the row immediately and restores it on failure", async () => {
  let reject;
  mocks.api.mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(page);
  render(<CreativeProjects />);
  await screen.findByText("上次的项目");
  fireEvent.click(screen.getByRole("button", { name: "项目菜单：上次的项目" }));
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("上次的项目")).toBeNull();
  await act(async () => reject(new Error("删除失败")));
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("删除失败");
});
