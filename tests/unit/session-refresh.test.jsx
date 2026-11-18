// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSession } from "next-auth/react";
import { Providers } from "../../src/app/providers";
import { SESSION_POLL_MS, SESSION_RETRY_MS } from "../../src/components/auth/ResilientSessionProvider";
import { readImageCapabilities } from "../../src/lib/studio/image-capabilities-client.js";

const state = vi.hoisted(() => ({ api: vi.fn(), answers: [] }));
vi.mock("@/lib/client-api", () => ({ api: state.api }));
vi.mock("next-auth/react", async () => {
  const { createContext, useContext } = await import("react");
  const SessionContext = createContext(undefined);
  return { SessionContext, useSession: () => useContext(SessionContext) };
});
vi.mock("@/components/auth/AuthProvider", () => ({ AuthProvider: ({ children }) => children }));
vi.mock("@/components/billing/RechargeProvider", () => ({ RechargeProvider: ({ children }) => children }));

const signedIn = (credits = 10) => ({ user: { id: "user", credits }, expires: "later" });
const reply = body => ({ ok: true, json: async () => body });
const failure = { ok: false, json: async () => ({}) };
let fetchMock;

function Probe() {
  const { status, data, update } = useSession();
  return <><output data-testid="probe">{`${status}:${data?.user?.credits ?? "-"}`}</output><button data-testid="refresh" onClick={() => update()} /></>;
}
const mount = () => render(<Providers><Probe /></Providers>);
const shown = () => screen.getByTestId("probe").textContent;
const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const emit = event => act(async () => { window.dispatchEvent(event); await vi.advanceTimersByTimeAsync(0); });
const crossTab = () => emit(new StorageEvent("storage", { key: "nextauth.message" }));

beforeEach(() => {
  vi.useFakeTimers();
  state.answers = [];
  // Answers are consumed in order; the last one repeats.
  fetchMock = vi.fn(async () => {
    const next = state.answers.length > 1 ? state.answers.shift() : state.answers[0];
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("stays loading until the server answers, then exposes the verified session", async () => {
  state.answers = [reply(signedIn())];
  mount();
  expect(shown()).toBe("loading:-");
  await settle();
  expect(shown()).toBe("authenticated:10");
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ cache: "no-store" }));
});

it("recovers a first load whose session read fails instead of showing a signed-out page", async () => {
  state.answers = [failure, new Error("network"), reply(signedIn())];
  mount();
  await settle();
  expect(shown()).toBe("loading:-");
  await settle(SESSION_RETRY_MS);
  expect(shown()).toBe("loading:-");
  await settle(SESSION_RETRY_MS);
  expect(shown()).toBe("authenticated:10");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("keeps the session when a periodic refresh fails or is refused once", async () => {
  state.answers = [reply(signedIn(10)), failure, reply(null), reply(signedIn(7))];
  mount();
  await settle();
  await settle(SESSION_POLL_MS);
  expect(shown()).toBe("authenticated:10");
  await settle(SESSION_RETRY_MS);
  expect(shown()).toBe("authenticated:10");
  await settle(SESSION_RETRY_MS);
  expect(shown()).toBe("authenticated:7");
});

it("never ends a session because the server is unreachable", async () => {
  state.answers = [reply(signedIn()), new Error("offline")];
  mount();
  await settle();
  await settle(SESSION_POLL_MS * 5);
  expect(shown()).toBe("authenticated:10");
});

it("ends the session once the server refuses it twice in a row", async () => {
  state.answers = [reply(signedIn()), reply(null)];
  mount();
  await settle();
  await settle(SESSION_POLL_MS);
  expect(shown()).toBe("authenticated:10");
  await settle(SESSION_RETRY_MS);
  expect(shown()).toBe("unauthenticated:-");
});

it("treats an empty answer as an ordinary anonymous visit and stops polling", async () => {
  state.answers = [reply({})];
  mount();
  await settle();
  expect(shown()).toBe("unauthenticated:-");
  await settle(SESSION_POLL_MS * 3);
  await emit(new Event("online"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("stops loading after repeated failures but keeps trying in the background", async () => {
  state.answers = [failure, failure, failure, reply(signedIn())];
  mount();
  await settle();
  await settle(SESSION_RETRY_MS);
  await settle(SESSION_RETRY_MS);
  expect(shown()).toBe("unauthenticated:-");
  await settle(SESSION_POLL_MS);
  expect(shown()).toBe("authenticated:10");
});

it("refreshes on demand, on network recovery and when another tab signs out", async () => {
  state.answers = [reply(signedIn(10)), reply(signedIn(20)), reply(signedIn(30)), reply({})];
  mount();
  await settle();
  await act(async () => { screen.getByTestId("refresh").click(); await vi.advanceTimersByTimeAsync(0); });
  expect(shown()).toBe("authenticated:20");
  // A reconnect right after a verified read is not worth another request.
  await emit(new Event("online"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await settle(31000);
  await emit(new Event("online"));
  expect(shown()).toBe("authenticated:30");
  await crossTab();
  expect(shown()).toBe("unauthenticated:-");
});

it("clears the model catalog when logout changes the verified session", async () => {
  state.api.mockReset().mockResolvedValue({ imageModels: [], imageProvider: null });
  state.answers = [reply(signedIn()), reply({}), reply(signedIn())];
  mount();
  await settle();
  await readImageCapabilities("user");
  await crossTab();
  await crossTab();
  await readImageCapabilities("user");
  expect(state.api).toHaveBeenCalledTimes(2);
});

it("ignores an answer that arrives after the tree unmounted", async () => {
  let answer;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  const view = mount();
  view.unmount();
  await act(async () => { answer(reply(signedIn())); await vi.advanceTimersByTimeAsync(SESSION_POLL_MS * 2); });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
