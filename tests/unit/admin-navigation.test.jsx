// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import AdminNav from "../../src/components/admin/AdminNav.js";

const state = vi.hoisted(() => ({ locale: "zh", pathname: "/admin/storage", navigate: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => state.locale }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => null }));
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
afterEach(() => { cleanup(); state.locale = "zh"; state.navigate.mockClear(); });

test.each([false, true])("admin navigation uses locale-aware client transitions (mobile=%s)", mobile => {
  render(<AdminNav mobile={mobile} />);
  const storage = screen.getByRole("link", { name: "云存储与图片加速" });
  expect(storage.getAttribute("href")).toBe("/zh/admin/storage");
  expect(storage.getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("link", { name: "用户管理" }));
  expect(state.navigate).toHaveBeenCalledWith("/admin/users");
});

test("does not eagerly prefetch every admin route and warms only the intended link", () => {
  render(<AdminNav />);
  const navigation = screen.getByRole("navigation");
  expect(within(navigation).getAllByRole("link").every(link => link.dataset.prefetch === "false")).toBe(true);
  fireEvent.mouseEnter(screen.getByRole("link", { name: "用户管理" }));
  expect(screen.getByRole("link", { name: "用户管理" }).dataset.prefetch).toBe("true");
  expect(screen.getByRole("link", { name: "云存储与图片加速" }).dataset.prefetch).toBe("false");
});

test("preserves the current locale without duplicating its prefix", () => {
  state.locale = "en";
  render(<AdminNav />);
  expect(screen.getByRole("link", { name: "用户管理" }).getAttribute("href")).toBe("/en/admin/users");
});
