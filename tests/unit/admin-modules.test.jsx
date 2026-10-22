// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AdminModules, { AdminModuleContent } from "../../src/components/admin/AdminModules.jsx";
import AdminNav from "../../src/components/admin/AdminNav.js";

const mocks = vi.hoisted(() => ({ nextNavigation: vi.fn(), reads: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => useSyncExternalStore(subscribe, () => window.location.pathname) }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => useSyncExternalStore(subscribe, () => window.location.pathname.replace(/^\/(?:zh|en)/, "") || "/"),
  Link: ({ href, children, prefetch, onClick, onNavigate, ...props }) => <a {...props} href={`/zh${href}`} data-prefetch={String(prefetch)} onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      onNavigate?.({ preventDefault: () => event.preventDefault() });
      if (!event.defaultPrevented) mocks.nextNavigation(href);
    }
    event.preventDefault();
  }}>{children}</a>,
}));
vi.mock("../../src/app/[locale]/admin/page.js", () => ({ default: () => <h1>看板内容</h1> }));
vi.mock("../../src/app/[locale]/admin/users/page.js", () => ({ default: () => <h1>用户列表内容</h1> }));
vi.mock("../../src/app/[locale]/admin/orders/page.js", () => ({ default: () => <h1>订单列表内容</h1> }));
vi.mock("../../src/app/[locale]/admin/announcements/page.js", () => ({ default: () => <h1>公告管理内容</h1> }));
vi.mock("../../src/app/[locale]/admin/providers/page.js", async () => {
  const { useEffect } = await import("react");
  return { default: function Providers() {
    useEffect(() => {
      const controller = new AbortController();
      mocks.reads("/api/admin/providers", controller.signal);
      return () => controller.abort();
    }, []);
    return <h1>模型配置内容</h1>;
  } };
});

function subscribe(callback) {
  window.addEventListener("admin-test-history", callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener("admin-test-history", callback); window.removeEventListener("popstate", callback); };
}
function Shell() {
  return <AdminModules><div data-admin-shell><AdminNav /><main data-admin-content><AdminModuleContent><p>服务端普通页面内容</p></AdminModuleContent></main></div></AdminModules>;
}
beforeEach(() => {
  window.history.replaceState(null, "", "/zh/admin");
  mocks.nextNavigation.mockReset(); mocks.reads.mockReset();
  const push = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => { push(...args); window.dispatchEvent(new Event("admin-test-history")); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("switches actual admin modules without a Next page navigation or RSC round trip", async () => {
  render(<Shell />);
  expect(await screen.findByRole("heading", { name: "看板内容" })).toBeTruthy();
  const providers = screen.getByRole("link", { name: "模型配置" });
  expect(providers.dataset.prefetch).toBe("false");
  const content = document.querySelector("[data-admin-content]");
  content.scrollTop = 500;
  fireEvent.click(providers);
  expect(window.location.pathname).toBe("/zh/admin/providers");
  expect(content.scrollTop).toBe(0);
  expect(providers.getAttribute("aria-current")).toBe("page");
  expect(await screen.findByRole("heading", { name: "模型配置内容" })).toBeTruthy();
  expect(mocks.nextNavigation).not.toHaveBeenCalled();
  expect(mocks.reads).toHaveBeenCalledTimes(1);
  const pending = mocks.reads.mock.calls[0][1];
  fireEvent.click(screen.getByRole("link", { name: "用户管理" }));
  expect(await screen.findByRole("heading", { name: "用户列表内容" })).toBeTruthy();
  expect(pending.aborted).toBe(true);
  expect(mocks.nextNavigation).not.toHaveBeenCalled();
});

test("browser history selects the corresponding module and keeps the locale", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "看板内容" });
  fireEvent.click(screen.getByRole("link", { name: "用户管理" }));
  await screen.findByRole("heading", { name: "用户列表内容" });
  act(() => { window.history.replaceState(null, "", "/zh/admin"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(await screen.findByRole("heading", { name: "看板内容" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "数据看板" }).getAttribute("aria-current")).toBe("page");
});

test("modified clicks remain ordinary links and the remaining admin modules also navigate locally", async () => {
  render(<Shell />);
  await screen.findByRole("heading", { name: "看板内容" });
  fireEvent.click(screen.getByRole("link", { name: "用户管理" }), { ctrlKey: true });
  expect(window.history.pushState).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "订单管理" }));
  await screen.findByRole("heading", { name: "订单列表内容" });
  fireEvent.click(screen.getByRole("link", { name: "公告管理" }));
  await screen.findByRole("heading", { name: "公告管理内容" });
  expect(mocks.nextNavigation).not.toHaveBeenCalled();
  const navigationLabels = new Set(["数据看板", "运行与账务", "模型配置", "分辨率积分", "工具配置", "云存储与图片加速", "用户管理", "生成审计", "灵感管理", "订单管理", "充值与支付", "成本利润", "分销佣金", "系统设置", "公告管理", "模特预设", "场景预设", "Prompt 模板"]);
  for (const link of screen.getAllByRole("link")) if (navigationLabels.has(link.textContent.trim())) expect(link.dataset.prefetch).toBe("false");
});
