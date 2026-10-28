// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rechargeReturnPath } from "../../src/lib/billing-return.js";
import RetiredPricingPage from "../../src/app/[locale]/(creative)/pricing/page.js";
import { RechargeProvider } from "../../src/components/billing/RechargeProvider";

const mocks = vi.hoisted(() => ({ query: "", auth: vi.fn(), redirect: vi.fn(), dynamicCount: 0 }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.query), usePathname: () => "/zh", redirect: (...args) => mocks.redirect(...args) }));
vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
vi.mock("../../src/components/auth/AuthProvider", () => ({ useAuth: () => ({ open: mocks.auth }) }));
vi.mock("../../src/components/ui/Modal", () => ({ default: ({ children, onClose, label }) => <div role="dialog" aria-label={label}>{children}<button onClick={onClose}>Close</button></div> }));
vi.mock("next/dynamic", () => ({ default: () => {
  const index = mocks.dynamicCount++;
  if (index === 0) return function Records({ initialTab, onClose }) { return <div role="dialog" aria-label={initialTab}><button onClick={onClose}>Close</button></div>; };
  if (index === 1) return function Recharge({ onRecords }) { return <button onClick={onRecords}>Orders</button>; };
  return function Invite() { return <div role="dialog" aria-label="Invite" />; };
} }));

beforeEach(() => { mocks.query = ""; mocks.redirect.mockReset(); window.history.replaceState(null, "", "/zh"); });
afterEach(cleanup);

it("builds a localized modal return with only validated payment parameters", () => {
  expect(rechargeReturnPath("zh", { orderId: "order_123" })).toBe("/zh?panel=recharge&orderId=order_123");
  expect(rechargeReturnPath("en", { checkout: "cancelled" })).toBe("/en?panel=recharge&checkout=cancelled");
  expect(rechargeReturnPath("//external", { orderId: "../bad", checkout: "paid", redirect: "https://example.com" })).toBe("/zh?panel=recharge");
});

it("keeps old pricing bookmarks and payment returns redirect-only", async () => {
  await RetiredPricingPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ orderId: "old_order", checkout: "success" }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/en?panel=recharge&orderId=old_order&checkout=success");
});

it("opens recharge on payment return and removes consumed parameters on close", async () => {
  mocks.query = "panel=recharge&orderId=order_123&checkout=success&keep=1";
  window.history.replaceState(null, "", `/zh?${mocks.query}`);
  render(<RechargeProvider><p>Homepage</p></RechargeProvider>);
  await screen.findByRole("dialog", { name: "积分充值" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(window.location.search).toBe("?keep=1");
});

it.each(["usage", "orders"])("preserves the %s records modal", async tab => {
  mocks.query = `records=${tab}`;
  render(<RechargeProvider><p>Homepage</p></RechargeProvider>);
  expect(await screen.findByRole("dialog", { name: tab })).not.toBeNull();
});
