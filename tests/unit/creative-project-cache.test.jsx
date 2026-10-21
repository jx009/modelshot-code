// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import CreativeProjects from "../../src/components/discover/CreativeProjects.jsx";

const mocks = vi.hoisted(() => ({ api: vi.fn(), session: null, serial: 0 }));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
vi.mock("next-auth/react", () => ({ useSession: () => mocks.session }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/ui/NavigationLink", () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock("@/components/studio/AssetImage", () => ({ default: () => null }));
const page = { items: [{ id: "project", name: "上次的项目", kind: "canvas", updatedAt: "2026-10-21T00:00:00Z" }], nextCursor: null };

beforeEach(() => {
  mocks.api.mockReset();
  mocks.session = { status: "authenticated", data: { user: { id: `user-${++mocks.serial}` } } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("revisiting projects displays the snapshot while revalidating", async () => {
  mocks.api.mockResolvedValueOnce(page);
  const initial = render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
  initial.unmount();
  let finish;
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CreativeProjects />);
  expect(await screen.findByText("上次的项目")).toBeTruthy();
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
