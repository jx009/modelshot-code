import { expect, it } from "vitest";
import { WEB_RUNTIME_CHANNEL, webRuntimeMessage, webRuntimeShell } from "../../src/lib/creation/web-runtime.js";

it("accepts only bounded navigation from the active opaque frame and handshake", () => {
  const source = {}, token = "preview-session-123456", options = { source, token, paths: ["pages/about.html"] };
  const event = { source, origin: "null", data: { channel: WEB_RUNTIME_CHANNEL, token, type: "navigate", path: "pages/about.html" } };
  expect(webRuntimeMessage(event, options)).toEqual({ type: "navigate", path: "pages/about.html" });
  for (const invalid of [{ ...event, source: {} }, { ...event, origin: "https://app.test" }, { ...event, data: { ...event.data, token: "stale-token" } }, { ...event, data: { ...event.data, path: "https://evil.test" } }, { ...event, data: { ...event.data, html: "extra" } }]) expect(webRuntimeMessage(invalid, options)).toBeNull();
  expect(webRuntimeMessage({ ...event, data: { channel: WEB_RUNTIME_CHANNEL, token, type: "ready" } }, options)).toEqual({ type: "ready" });
});
it("escapes shell configuration and does not embed user documents or credentials", () => {
  const shell = webRuntimeShell("https://app.test");
  expect(shell).toContain('event.origin !== config.parentOrigin');
  expect(shell).toContain('event.source !== parent');
  expect(shell).not.toContain("allow-same-origin");
  expect(webRuntimeShell("</script><img>").match(/<\/script>/g)).toHaveLength(1);
});
