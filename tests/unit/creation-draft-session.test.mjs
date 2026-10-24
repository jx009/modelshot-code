import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });
it("uses a fresh per-realm identity, so copied sessionStorage cannot share write ownership", async () => {
  const randomUUID = vi.fn().mockReturnValueOnce("first-session-123456").mockReturnValueOnce("second-session-12345");
  vi.stubGlobal("crypto", { randomUUID }); vi.stubGlobal("sessionStorage", { getItem() { throw new Error("Do not inherit tab identity"); } });
  const first = await import("../../src/lib/creation/client/draft-session.js");
  expect(first.creationDraftSession()).toBe("first-session-123456"); expect(first.creationDraftSession()).toBe("first-session-123456");
  vi.resetModules(); const second = await import("../../src/lib/creation/client/draft-session.js");
  expect(second.creationDraftSession()).toBe("second-session-12345"); expect(randomUUID).toHaveBeenCalledTimes(2);
});
it("bounds remembered choices and scopes them by account and artwork", async () => {
  const session = await import("../../src/lib/creation/client/draft-session.js");
  session.rememberDraftSession("u", "a"); expect(session.hasOpenedDraftSession("u", "a")).toBe(true); expect(session.hasOpenedDraftSession("other", "a")).toBe(false);
  for (let i = 0; i < 32; i++) session.rememberDraftSession("u", `new${i}`);
  expect(session.hasOpenedDraftSession("u", "a")).toBe(false); expect(session.hasOpenedDraftSession("u", "new31")).toBe(true);
});
