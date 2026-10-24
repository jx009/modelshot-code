import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

let server, baseURL;
test.beforeAll(async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Creation canvas regression fixture</title><style>
    *{box-sizing:border-box}body{margin:0;font-family:Arial;background:#eee}nav{height:44px;display:flex;gap:12px;align-items:center;padding:8px}
    .harness-body{display:flex;height:850px}.cw-layout-canvas{position:relative;flex:1;min-width:0;overflow:hidden;outline:none}
    aside{width:240px;overflow:auto;background:white;padding:12px}label{display:block;margin:8px 0}input,select,textarea{display:block;width:100%}
    .cw-canvas-text{position:absolute;margin:0;padding:0;border:1px solid blue;transform-origin:top left;background:transparent;resize:none;z-index:5}
    button{padding:5px}header{font-weight:bold}pre{white-space:pre-wrap}
  </style><div id="root"></div><script type="module" src="/creation-canvas-browser.jsx"></script></html>`;
  server = await createServer({
    configFile: false, root: `${root}tests/fixtures`, appType: "custom", logLevel: "warn",
    cacheDir: `${root}node_modules/.vite/creation-canvas`,
    resolve: { alias: { "@": `${root}src` } },
    css: { postcss: { plugins: [] } },
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", "react-konva", "konva", "zod", "lucide-react"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root] } },
    plugins: [{ name: "canvas-fixture-html", configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); }
        else if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); }
        else next();
      });
    } }],
  });
  await server.listen();
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
});
test.afterAll(async () => { await server?.close(); });

async function setup(page) {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(baseURL);
  const canvas = page.locator(".cw-layout-canvas"), inspector = page.getByRole("complementary", { name: "作品属性" });
  await expect(canvas.locator("canvas")).toBeVisible();
  const point = async (x, y) => {
    const box = await canvas.boundingBox(), scale = Math.min((box.width - 80) / 1920, (box.height - 80) / 1080);
    return { x: box.x + (box.width - 1920 * scale) / 2 + x * scale, y: box.y + (box.height - 1080 * scale) / 2 + y * scale, scale };
  };
  const click = async (x, y, options) => { const p = await point(x, y); await page.mouse.click(p.x, p.y, options); };
  const drag = async (x, y, dx, dy) => {
    const p = await point(x, y), startX = Math.round(p.x), startY = Math.round(p.y);
    const endX = Math.round(p.x + dx * p.scale), endY = Math.round(p.y + dy * p.scale);
    await page.mouse.move(startX, startY); await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 }); await page.mouse.up();
    return { dx: (endX - startX) / p.scale, dy: (endY - startY) / p.scale };
  };
  const document = async () => JSON.parse(await page.getByTestId("content").textContent());
  return { canvas, inspector, click, drag, document, errors };
}

test("real Konva text and shapes keep frame picking, drag, resize, rotation, lock and undo", async ({ page }, info) => {
  const f = await setup(page), { inspector } = f;
  await f.click(760, 330); await expect(inspector.locator("header")).toHaveText("标题");
  const textDelta = await f.drag(760, 330, 80, 40);
  await expect.poll(async () => (await f.document()).pages[0].nodes[0].x).toBeCloseTo(200 + textDelta.dx, 4);
  await expect.poll(async () => (await f.document()).pages[0].nodes[0].y).toBeCloseTo(180 + textDelta.dy, 4);
  await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(inspector.getByLabel("x", { exact: true })).toHaveValue("200");
  await f.drag(800, 360, 120, 36);
  await expect.poll(async () => (await f.document()).pages[0].nodes[0].width).toBeGreaterThan(650);
  expect((await f.document()).pages[0].nodes[0].text).toBe("测试文字");
  await page.getByRole("button", { name: "撤销", exact: true }).click(); await expect(inspector.getByLabel("width", { exact: true })).toHaveValue("600");
  await f.click(1160, 680); await expect(inspector.locator("header")).toHaveText("透明矩形");
  const rectDelta = await f.drag(1160, 680, 80, -40);
  await expect.poll(async () => (await f.document()).pages[0].nodes[1].x).toBeCloseTo(1000 + rectDelta.dx, 4);
  await inspector.getByRole("button", { name: "锁定", exact: true }).click();
  await f.drag(1240, 640, 80, 80);
  expect((await f.document()).pages[0].nodes[1]).toMatchObject({ locked: true, fill: "#00000000", radius: 20 });
  expect((await f.document()).pages[0].nodes[1].x).toBeCloseTo(1000 + rectDelta.dx, 4);
  await inspector.getByRole("button", { name: "解锁", exact: true }).click();
  await inspector.getByLabel("rotation", { exact: true }).fill("30");
  await expect.poll(async () => (await f.document()).pages[0].nodes[1].rotation).toBe(30);
  await f.click(300, 750); await expect(inspector.locator("header")).toHaveText("圆形");
  const ellipseDelta = await f.drag(300, 750, 40, 0); await expect.poll(async () => (await f.document()).pages[0].nodes[2].x).toBeCloseTo(200 + ellipseDelta.dx, 4);
  await f.click(700, 760); await expect(inspector.locator("header")).toHaveText("线条");
  await page.screenshot({ path: info.outputPath("canvas-gestures.png") });
  expect(f.errors).toEqual([]);
});

test("reused canvas commits text to the original page and obeys readonly state", async ({ page }) => {
  const f = await setup(page);
  const original = await f.canvas.locator("canvas").elementHandle();
  await f.click(400, 230, { clickCount: 2 });
  const input = page.getByRole("textbox", { name: "编辑选中文字 / Edit selected text" });
  await expect(input).toBeVisible(); await input.fill("仅第一页修改");
  await page.getByRole("button", { name: "切页", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect((await f.document()).pages[0].nodes[0].text).toBe("仅第一页修改");
  expect((await f.document()).pages[1].nodes[0].text).toBe("第二页标题");
  expect(await original.evaluate(node => node === document.querySelector(".cw-layout-canvas canvas"))).toBe(true);
  await page.getByRole("button", { name: "只读", exact: true }).click();
  await f.click(400, 230, { clickCount: 2 }); await expect(input).toHaveCount(0);
  await f.drag(760, 330, 100, 100);
  expect((await f.document()).pages[1].nodes[0].x).toBe(200);
  expect(f.errors).toEqual([]);
});
