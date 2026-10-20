// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NavigationLink from "../../src/components/ui/NavigationLink.jsx";

const state = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: state.pending }) }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => null }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, prefetch, onNavigate, onClick, ...props }) => <a {...props} onClick={event => {
  onClick?.(event);
  if (!event.defaultPrevented) onNavigate?.({ preventDefault: () => event.preventDefault() });
  event.preventDefault();
}}>{children}</a> }));
afterEach(() => { cleanup(); state.pending = false; vi.useRealTimers(); });

it("keeps repeat clicks in place and offers an explicit recovery link only after waiting", () => {
  vi.useFakeTimers();
  const view = render(<NavigationLink href="/zh/assets">素材库</NavigationLink>);
  fireEvent.click(screen.getByText("素材库"));
  state.pending = true;
  view.rerender(<NavigationLink href="/zh/assets">素材库</NavigationLink>);
  act(() => vi.advanceTimersByTime(2500));
  expect(screen.getByRole("status").textContent).toBe("正在打开…");
  expect(screen.queryByText(/连接较慢/)).toBeNull();
  fireEvent.click(screen.getByText("素材库"));
  act(() => vi.advanceTimersByTime(5500));
  expect(screen.getByRole("link", { name: "重新打开页面" }).getAttribute("href")).toBe(new URL("/zh/assets", window.location.href).href);
  state.pending = false;
  view.rerender(<NavigationLink href="/zh/assets">素材库</NavigationLink>);
  expect(screen.queryByRole("status")).toBeNull();
});
