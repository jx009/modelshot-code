// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { registerNavigationGuard, deferNavigation, hasNavigationGuard } from "../../src/lib/navigation-guard.js";

const unregister = [];
const register = guard => { const remove = registerNavigationGuard(guard); unregister.push(remove); return remove; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settled = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const originalNavigation = Object.getOwnPropertyDescriptor(window, "navigation");
afterEach(() => {
  for (const remove of unregister.splice(0)) remove();
  if (originalNavigation) Object.defineProperty(window, "navigation", originalNavigation);
  else delete window.navigation;
  window.history.replaceState({}, "", "/");
});

function historyAPI() {
  const navigation = new EventTarget();
  navigation.currentEntry = { key: "editor" };
  navigation.addEventListener = vi.fn(navigation.addEventListener.bind(navigation));
  navigation.removeEventListener = vi.fn(navigation.removeEventListener.bind(navigation));
  function request(key, overrides = {}) {
    const { cancelable = true, ...properties } = overrides;
    const event = new Event("navigate", { cancelable });
    Object.assign(event, { navigationType: "traverse", destination: { key, sameDocument: true }, ...properties });
    navigation.dispatchEvent(event);
    return event;
  }
  navigation.traverseTo = vi.fn(key => {
    const finished = Promise.resolve().then(() => {
      if (request(key).defaultPrevented) throw new Error("unexpected cancelled replay");
      navigation.currentEntry = { key };
    });
    return { committed: finished, finished };
  });
  Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
  return { navigation, request };
}

it("keeps unguarded navigation synchronous without invoking its continuation", () => {
  const go = vi.fn(); expect(deferNavigation(go)).toBe(false); expect(go).not.toHaveBeenCalled();
});
it("saves once for repeated clicks and resumes only the first intended transition", async () => {
  const saving = deferred(), guard = { prepare: vi.fn(() => saving.promise), finish: vi.fn() }, first = vi.fn(), second = vi.fn();
  register(guard);
  expect(deferNavigation(first)).toBe(true); expect(deferNavigation(second)).toBe(true);
  expect(guard.prepare).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
  saving.resolve(); await settled();
  expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled(); expect(guard.finish).toHaveBeenCalledOnce();
});
it("reports save errors and permits retry without proceeding", async () => {
  const guard = { prepare: vi.fn().mockRejectedValueOnce(new Error("save failed")).mockResolvedValue(undefined), onError: vi.fn(), finish: vi.fn() }, go = vi.fn();
  register(guard); deferNavigation(go); await settled();
  expect(go).not.toHaveBeenCalled(); expect(guard.onError.mock.calls[0][0].message).toBe("save failed");
  deferNavigation(go); await settled(); expect(go).toHaveBeenCalledOnce(); expect(guard.finish).toHaveBeenCalledTimes(2);
});
it("does not reenter guards when the continuation calls another guarded navigation layer", async () => {
  const guard = { prepare: vi.fn().mockResolvedValue(undefined) }, go = vi.fn();
  register(guard); deferNavigation(() => { expect(hasNavigationGuard()).toBe(false); if (!deferNavigation(go)) go(); });
  await settled(); expect(go).toHaveBeenCalledOnce(); expect(guard.prepare).toHaveBeenCalledOnce(); expect(hasNavigationGuard()).toBe(true);
});
it("cancels an unmounted workspace continuation without blocking a new workspace", async () => {
  const oldSave = deferred(), oldGo = vi.fn(), newGo = vi.fn(), remove = register({ prepare: () => oldSave.promise });
  deferNavigation(oldGo); remove(); register({ prepare: async () => {} });
  deferNavigation(newGo); await settled(); expect(newGo).toHaveBeenCalledOnce();
  oldSave.resolve(); await settled(); expect(oldGo).not.toHaveBeenCalled();
});
it("does not route to an old destination after browser history changed during the save", async () => {
  const saving = deferred(), go = vi.fn(); register({ prepare: () => saving.promise }); deferNavigation(go);
  window.history.replaceState({}, "", "/zh/projects"); saving.resolve(); await settled(); expect(go).not.toHaveBeenCalled();
});
it("releases every guard when a later preflight rejects or the router throws", async () => {
  const first = { prepare: vi.fn().mockResolvedValue(undefined), finish: vi.fn() }, second = { prepare: vi.fn().mockRejectedValueOnce(new Error("no")).mockResolvedValue(undefined), finish: vi.fn(), onError: vi.fn() };
  register(first); register(second); const go = vi.fn(() => { throw new Error("router failed"); });
  deferNavigation(go); await settled(); expect(go).not.toHaveBeenCalled(); expect(first.finish).toHaveBeenCalledOnce();
  deferNavigation(go); await settled(); expect(go).toHaveBeenCalledOnce(); expect(second.onError.mock.calls.at(-1)[0].message).toBe("router failed"); expect(hasNavigationGuard()).toBe(true);
});

it("cancels Back before unmount, coalesces repeated Back/Forward, then replays only the exact entry", async () => {
  const { navigation, request } = historyAPI(), saving = deferred();
  const guard = { prepare: vi.fn(() => saving.promise), finish: vi.fn(), onError: vi.fn() };
  register(guard);
  expect(request("home").defaultPrevented).toBe(true);
  expect(request("earlier").defaultPrevented).toBe(true);
  expect(request("forward").defaultPrevented).toBe(true);
  expect(navigation.currentEntry.key).toBe("editor");
  expect(guard.prepare).toHaveBeenCalledOnce(); expect(navigation.traverseTo).not.toHaveBeenCalled();
  saving.resolve(); await settled();
  expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith("home");
  expect(navigation.currentEntry.key).toBe("home"); expect(guard.onError).not.toHaveBeenCalled();
  expect(guard.finish).toHaveBeenCalledOnce();
  expect(request("editor").defaultPrevented).toBe(true);
  await settled(); expect(guard.prepare).toHaveBeenCalledTimes(2);
});

it("keeps the current entry after failed save and allows browser Back retry", async () => {
  const { navigation, request } = historyAPI();
  const guard = { prepare: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined), onError: vi.fn() };
  register(guard); request("home"); await settled();
  expect(navigation.currentEntry.key).toBe("editor"); expect(navigation.traverseTo).not.toHaveBeenCalled();
  expect(guard.onError.mock.calls[0][0].message).toBe("offline");
  request("home"); await settled();
  expect(navigation.currentEntry.key).toBe("home"); expect(guard.prepare).toHaveBeenCalledTimes(2);
});

it("does not replay stale saves after a same-URL entry change", async () => {
  const { navigation, request } = historyAPI(), saving = deferred();
  register({ prepare: () => saving.promise }); request("home");
  navigation.currentEntry = { key: "another-editor-entry" };
  saving.resolve(); await settled(); expect(navigation.traverseTo).not.toHaveBeenCalled();
});

it("observes replay failures, releases the gate and does not leak a bypass on retry", async () => {
  const { navigation, request } = historyAPI();
  navigation.traverseTo.mockImplementationOnce(() => ({ committed: Promise.reject(new Error("entry removed")), finished: Promise.reject(new Error("entry removed")) }));
  const guard = { prepare: vi.fn().mockResolvedValue(undefined), finish: vi.fn(), onError: vi.fn() };
  register(guard); request("home"); await settled();
  expect(guard.onError.mock.calls[0][0].message).toBe("entry removed"); expect(guard.finish).toHaveBeenCalledOnce();
  expect(request("home").defaultPrevented).toBe(true); await settled();
  expect(guard.prepare).toHaveBeenCalledTimes(2); expect(navigation.currentEntry.key).toBe("home");
});

it("keeps asynchronous replay locked until it finishes, without a global asynchronous bypass", async () => {
  const { navigation, request } = historyAPI(), transition = deferred();
  navigation.traverseTo.mockImplementationOnce(() => ({ committed: transition.promise, finished: transition.promise }));
  const guard = { prepare: vi.fn().mockResolvedValue(undefined), finish: vi.fn() };
  register(guard); request("home"); await settled();
  expect(hasNavigationGuard()).toBe(true); expect(guard.finish).not.toHaveBeenCalled();
  expect(request("other").defaultPrevented).toBe(true);
  expect(guard.prepare).toHaveBeenCalledOnce();
  expect(request("home").defaultPrevented).toBe(false);
  expect(request("home").defaultPrevented).toBe(true); // Single-use replay.
  transition.resolve(); await settled(); expect(guard.finish).toHaveBeenCalledOnce();
});

it("registers one listener only while guards exist and cancels an unmounted traversal", async () => {
  const { navigation, request } = historyAPI(), saving = deferred();
  const first = register({ prepare: () => saving.promise }), second = register({ prepare: async () => {} });
  expect(navigation.addEventListener).toHaveBeenCalledOnce();
  request("home"); first(); second();
  expect(navigation.removeEventListener).toHaveBeenCalledOnce();
  saving.resolve(); await settled(); expect(navigation.traverseTo).not.toHaveBeenCalled();
  expect(request("home").defaultPrevented).toBe(false);
  register({ prepare: async () => {} }); expect(navigation.addEventListener).toHaveBeenCalledTimes(2);
});

it("leaves cross-document, uncancellable and non-traversal navigation to their existing handlers", () => {
  const { request } = historyAPI(), prepare = vi.fn(); register({ prepare });
  expect(request("external", { destination: { key: "external", sameDocument: false } }).defaultPrevented).toBe(false);
  expect(request("home", { cancelable: false }).defaultPrevented).toBe(false);
  expect(request("home", { navigationType: "push" }).defaultPrevented).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
});
