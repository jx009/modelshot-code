// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Providers } from "../../src/app/providers";
import { readImageCapabilities } from "../../src/lib/studio/image-capabilities-client.js";

const state = vi.hoisted(() => ({ session: null, status: "authenticated", update: vi.fn(), getSession: vi.fn(), providerProps: null, api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: state.api }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children, ...props }) => { state.providerProps = props; return children; }, useSession: () => ({ data: state.session, status: state.status, update: state.update }), getSession: state.getSession }));
vi.mock("@/components/auth/AuthProvider", () => ({ AuthProvider: ({ children }) => children }));
vi.mock("@/components/billing/RechargeProvider", () => ({ RechargeProvider: ({ children }) => children }));
beforeEach(() => { state.session = { user: { id: "user" } }; state.status = "authenticated"; state.update.mockReset().mockResolvedValue(null); state.getSession.mockReset().mockResolvedValue(null); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("clears the model catalog when logout changes the verified session", async () => {
  state.api.mockReset().mockResolvedValue({ imageModels: [], imageProvider: null });
  const view = render(<Providers><span>Home</span></Providers>);
  await readImageCapabilities("user");
  state.session = null; state.status = "unauthenticated";
  view.rerender(<Providers><span>Home</span></Providers>);
  state.session = { user: { id: "user" } }; state.status = "authenticated";
  view.rerender(<Providers><span>Home</span></Providers>);
  await readImageCapabilities("user");
  expect(state.api).toHaveBeenCalledTimes(2);
});

it("does not refresh on page renders, but still refreshes on network recovery", async () => {
  const view = render(<Providers><span>Home</span></Providers>);
  view.rerender(<Providers><span>Canvas</span></Providers>);
  await act(async () => {});
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(state.update).toHaveBeenCalledTimes(1);
});

it("disables unconditional focus reads but retains periodic and cross-tab session support", () => {
  render(<Providers><span>Home</span></Providers>);
  expect(state.providerProps).toMatchObject({ refetchInterval: 60, refetchOnWindowFocus: false, refetchWhenOffline: false });
});

it("coalesces network recovery events and handles failed refresh without unhandled rejection", async () => {
  vi.useFakeTimers();
  let reject;
  state.update.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<Providers><span>Home</span></Providers>);
  await act(async () => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("online")); });
  expect(state.update).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(31000); window.dispatchEvent(new Event("online")); });
  expect(state.update).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(state.update).toHaveBeenCalledTimes(2);
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(state.update).toHaveBeenCalledTimes(2);
});

it("keeps bounded server-verified recovery for a transient lost session", async () => {
  vi.useFakeTimers();
  const view = render(<Providers><span>Home</span></Providers>);
  state.session = null; state.status = "unauthenticated";
  view.rerender(<Providers><span>Home</span></Providers>);
  await act(async () => {});
  expect(state.getSession).toHaveBeenCalledWith({ broadcast: false });
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(state.getSession).toHaveBeenCalledTimes(4);
  act(() => window.dispatchEvent(new Event("focus")));
  act(() => window.dispatchEvent(new Event("online")));
  expect(state.getSession).toHaveBeenCalledTimes(4);
});

it("does not probe an ordinary anonymous visit", async () => {
  vi.useFakeTimers(); state.session = null; state.status = "unauthenticated";
  render(<Providers><span>Home</span></Providers>);
  act(() => window.dispatchEvent(new Event("focus")));
  act(() => window.dispatchEvent(new Event("online")));
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(state.getSession).not.toHaveBeenCalled();
});

it("does not overlap recovery requests or recover an unmounted tree", async () => {
  vi.useFakeTimers();
  let complete;
  state.getSession.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const view = render(<Providers><span>Home</span></Providers>);
  state.session = null; state.status = "unauthenticated";
  view.rerender(<Providers><span>Home</span></Providers>);
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(state.getSession).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => complete({ user: { id: "user" }, expires: "later" }));
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(state.getSession).toHaveBeenCalledTimes(1);
});
