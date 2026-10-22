// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AdminNav from "../../src/components/admin/AdminNav.js";
import NavigationFeedback from "../../src/components/ui/NavigationFeedback.jsx";
import NavigationContent from "../../src/components/ui/NavigationContent.jsx";

const state = vi.hoisted(() => ({ locale: "zh", pathname: "/admin/storage", navigate: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => state.locale }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => null }));
vi.mock("@/components/admin/AdminModules", () => ({ useAdminModules: () => null }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => state.pathname,
  Link: ({ href, children, prefetch, onClick, onNavigate, ...props }) => (
    <a {...props} href={`/${state.locale}${href}`} data-prefetch={String(prefetch)} onClick={event => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        onNavigate?.({ preventDefault: () => event.preventDefault() });
        if (!event.defaultPrevented) state.navigate(href);
      }
      event.preventDefault();
    }}>{children}</a>
  ),
}));
beforeEach(() => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 20, height: 20 }]);
});
afterEach(() => { cleanup(); state.locale = "zh"; state.pathname = "/admin/storage"; window.history.replaceState({}, "", "/"); state.navigate.mockClear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test.each([false, true])("admin navigation uses locale-aware client transitions (mobile=%s)", mobile => {
  render(<AdminNav mobile={mobile} />);
  const storage = screen.getByRole("link", { name: "云存储与图片加速" });
  expect(storage.getAttribute("href")).toBe("/zh/admin/storage");
  expect(storage.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "数据看板" }).dataset.prefetch).toBe("false");
  expect(screen.getByRole("link", { name: "用户管理" }).dataset.prefetch).toBe("false");
  expect(storage.dataset.prefetch).toBe("false");
  fireEvent.click(screen.getByRole("link", { name: "用户管理" }));
  expect(state.navigate).toHaveBeenCalledWith("/admin/users");
});

test("does not eagerly prefetch every admin route and warms only the intended link", () => {
  vi.useFakeTimers();
  render(<AdminNav />);
  const navigation = screen.getByRole("navigation");
  expect(within(navigation).getAllByRole("link").every(link => link.dataset.prefetch === "false")).toBe(true);
  fireEvent.mouseEnter(screen.getByRole("link", { name: "用户管理" }));
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByRole("link", { name: "用户管理" }).dataset.prefetch).toBe("true");
  expect(screen.getByRole("link", { name: "云存储与图片加速" }).dataset.prefetch).toBe("false");
});

test("does not prefetch any administrator module simply because the page is idle", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  render(<AdminNav />);
  act(() => vi.advanceTimersByTime(30000));
  expect(screen.getByRole("link", { name: "数据看板" }).dataset.prefetch).toBe("false");
  expect(screen.getByRole("link", { name: "用户管理" }).dataset.prefetch).toBe("false");
  expect(screen.getByRole("link", { name: "用户管理" }).dataset.prefetch).toBe("false");
  expect(screen.getByRole("link", { name: "生成审计" }).dataset.prefetch).toBe("false");
  fireEvent.mouseEnter(screen.getByRole("link", { name: "用户管理" }));
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByRole("link", { name: "用户管理" }).dataset.prefetch).toBe("true");
});

test("preserves the current locale without duplicating its prefix", () => {
  state.locale = "en";
  render(<AdminNav />);
  expect(screen.getByRole("link", { name: "用户管理" }).getAttribute("href")).toBe("/en/admin/users");
});

test("selects the destination and replaces admin content without waiting for routing", () => {
  window.history.replaceState({}, "", "/zh/admin/storage");
  render(<NavigationFeedback><NavigationContent><AdminNav /><NavigationContent section="admin"><p>旧存储设置</p></NavigationContent></NavigationContent></NavigationFeedback>);
  fireEvent.click(screen.getByRole("link", { name: "用户管理" }));
  expect(window.location.pathname).toBe("/zh/admin/storage");
  expect(screen.getByRole("heading", { name: "用户管理" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "用户管理" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "云存储与图片加速" }).getAttribute("aria-current")).toBeNull();
  expect(screen.getByText("旧存储设置").closest(".navigation-current").hidden).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "数据看板" }));
  expect(screen.getByRole("heading", { name: "数据看板" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "云存储与图片加速" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("旧存储设置").closest(".navigation-current").hidden).toBe(false);
  expect(state.navigate).toHaveBeenLastCalledWith("/admin/storage");
});
