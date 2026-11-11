// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InteractiveWebFrame from "../../src/components/creation/InteractiveWebFrame";
import { WEB_RUNTIME_CHANNEL } from "../../src/lib/creation/web-runtime.js";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/client-api", () => ({ api: (...args) => mocks.api(...args) }));
beforeEach(() => mocks.api.mockReset().mockResolvedValue({ url: "https://preview.test/api/creation-preview", appOrigin: location.origin }));
afterEach(cleanup);
it("sends one document after a bound handshake, preserves the frame on resize and rejects stale navigation", async () => {
  const navigate = vi.fn(), props = { srcDoc: "<h1>One</h1>", paths: ["about.html"], onNavigate: navigate, width: 1440, zh: false };
  let view;
  // Flush the runtime lookup and the iframe's message-listener effect before
  // simulating its handshake; finding a DOM node alone does not flush effects.
  await act(async () => { view = render(<InteractiveWebFrame {...props} />); });
  const frame = await screen.findByTitle("Interactive website preview"), token = new URL(frame.src).hash.slice(1);
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts"); expect(frame.hasAttribute("srcdoc")).toBe(false);
  const post = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
  const message = (type, extra = {}, source = frame.contentWindow) => act(() => { window.dispatchEvent(new MessageEvent("message", { source, origin: "null", data: { channel: WEB_RUNTIME_CHANNEL, token, type, ...extra } })); });
  message("ready", {}, {}); expect(post).not.toHaveBeenCalled();
  message("ready"); message("ready"); expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith({ channel: WEB_RUNTIME_CHANNEL, token, type: "render", html: props.srcDoc }, "*");
  message("navigate", { path: "about.html" }); expect(navigate).not.toHaveBeenCalled();
  message("rendered"); message("navigate", { path: "other.html" }); message("navigate", { path: "about.html", token: "stale" });
  expect(navigate).not.toHaveBeenCalled();
  message("navigate", { path: "about.html" }); expect(navigate).toHaveBeenCalledWith("about.html");
  view.rerender(<InteractiveWebFrame {...props} width={390} />);
  expect(screen.getByTitle("Interactive website preview")).toBe(frame); expect(frame.style.width).toBe("390px");
  view.rerender(<InteractiveWebFrame {...props} srcDoc="<h1>Two</h1>" />);
  await waitFor(() => expect(screen.getByTitle("Interactive website preview")).not.toBe(frame));
  message("navigate", { path: "about.html" }); expect(navigate).toHaveBeenCalledOnce();
  view.unmount(); expect(mocks.api.mock.calls[0][1].signal.aborted).toBe(true);
});
it("refuses a same-origin runtime without mounting executable content", async () => {
  mocks.api.mockResolvedValue({ url: `${location.origin}/api/creation-preview`, appOrigin: location.origin });
  render(<InteractiveWebFrame srcDoc="<script>bad()</script>" width={1440} paths={[]} zh={false} />);
  expect((await screen.findByRole("alert")).textContent).toContain("separate preview origin");
  expect(document.querySelector("iframe")).toBeNull();
});
