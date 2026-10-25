import { test, expect } from "@playwright/test";
import { JSDOM } from "jsdom";
import { prepareWebPreviewDocument } from "../../src/lib/creation/web-preview.js";
import { preparePreviewModules } from "../../src/lib/creation/web-modules.js";
import { webRuntimeShell, webRuntimeHeaders } from "../../src/lib/creation/web-runtime.js";

test("isolated shell executes local interactions, navigates local pages and blocks network/parent access", async ({ page, context }) => {
  const token = "runtime-browser-check-123456";
  const requests = [];
  const shell = webRuntimeShell("http://app.test");
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()); requests.push(url.href);
    if (url.hostname === "preview.test" && url.pathname === "/api/creation-preview") return route.fulfill({ status: 200, contentType: "text/html", body: shell, headers: webRuntimeHeaders("http://app.test") });
    if (url.hostname === "app.test") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Application host</title>" });
    return route.abort();
  });
  const dom = new JSDOM(""); globalThis.document = dom.window.document;
  let html;
  try {
    html = prepareWebPreviewDocument({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [
      { id: "home", path: "index.html", kind: "html", content: '<h1>咖啡店</h1><input id="name" data-name="name"><button id="hello">Say hello</button><output id="result"></output><a href="pages/about.html">About</a><script src="app.js"></script><script type="module" src="module.js"></script>' },
      { id: "module", path: "module.js", kind: "js", content: 'import { value } from "./value.js"; document.body.dataset.module = value;' },
      { id: "value", path: "value.js", kind: "js", content: 'export const value = "ready";' },
      { id: "about", path: "pages/about.html", kind: "html", content: "<h1>About</h1>" },
      { id: "code", path: "app.js", kind: "js", content: 'document.querySelector("#hello").addEventListener("click", () => {document.querySelector("#result").textContent = "你好，" + document.querySelector("[data-name=name]").value});' },
    ] }, { interactive: true, prepareModules: preparePreviewModules }).render();
  } finally { delete globalThis.document; dom.window.close(); }
  // Hostile author code is intentionally included to verify the browser's
  // actual enforcement, rather than trusting source regexes as a sandbox.
  html = html.replace("</body>", `<script>try { parent.document.title = "escaped"; } catch { document.body.dataset.isolated = "yes"; } fetch("https://blocked.test/leak").catch(() => document.body.dataset.network = "blocked");</script></body>`);
  await page.goto("http://app.test");
  await page.evaluate(({ token, html }) => {
    window.runtimeEvents = [];
    const frame = document.createElement("iframe");
    frame.sandbox = "allow-scripts"; frame.style.width = "900px"; frame.style.height = "600px";
    window.addEventListener("message", event => {
      if (event.source !== frame.contentWindow || event.origin !== "null" || event.data.token !== token) return;
      window.runtimeEvents.push(event.data);
      if (event.data.type === "ready") frame.contentWindow.postMessage({ channel: "modelshot-web-runtime-v1", token, type: "render", html }, "*");
    });
    frame.src = `http://preview.test/api/creation-preview#${token}`; document.body.append(frame);
  }, { token, html });
  const preview = page.frameLocator("iframe");
  await expect(preview.getByRole("heading", { name: "咖啡店" })).toBeVisible();
  await expect(preview.locator("body")).toHaveAttribute("data-module", "ready");
  await preview.locator("#name").fill("小陈");
  await preview.getByRole("button", { name: "Say hello" }).click();
  await expect(preview.locator("#result")).toHaveText("你好，小陈");
  await expect(preview.locator("body")).toHaveAttribute("data-isolated", "yes");
  await expect(preview.locator("body")).toHaveAttribute("data-network", "blocked");
  await preview.getByRole("link", { name: "About" }).click();
  await expect.poll(() => page.evaluate(() => window.runtimeEvents.some(event => event.type === "navigate" && event.path === "pages/about.html"))).toBe(true);
  await expect(page).toHaveTitle("Application host");
  expect(requests.some(url => url.includes("blocked.test"))).toBe(false);
  expect(await page.evaluate(() => window.runtimeEvents.filter(event => event.type === "rendered").length)).toBe(1);
});
