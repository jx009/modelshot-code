// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Providers } from "../../src/app/providers";

const state = vi.hoisted(() => ({ session: null, status: "authenticated", update: vi.fn(), getSession: vi.fn() }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }) => children, useSession: () => ({ data: state.session, status: state.status, update: state.update }), getSession: state.getSession }));
vi.mock("@/components/auth/AuthProvider", () => ({ AuthProvider: ({ children }) => children }));
vi.mock("@/components/billing/RechargeProvider", () => ({ RechargeProvider: ({ children }) => children }));
beforeEach(() => { state.session = { user: { id: "user" } }; state.status = "authenticated"; state.getSession.mockReset().mockResolvedValue(null); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("does not refresh on page renders, but still refreshes on network recovery", async () => {
  const view = render(<Providers><span>Home</span></Providers>);
  view.rerender(<Providers><span>Canvas</span></Providers>);
  await act(async () => {});
  expect(state.update).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event("online")));
  expect(state.update).toHaveBeenCalledTimes(1);
});

it("keeps bounded server-verified recovery for a transient lost session", async () => {
  vi.useFakeTimers(); state.session = null; state.status = "unauthenticated";
  render(<Providers><span>Home</span></Providers>);
  await act(async () => {});
  expect(state.getSession).toHaveBeenCalledWith({ broadcast: false });
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(state.getSession).toHaveBeenCalledTimes(4);
});
