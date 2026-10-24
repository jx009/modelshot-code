import { test, expect } from "@playwright/test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";

let server, baseURL;
test.beforeAll(async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Native input recovery fixture</title><style>
    *{box-sizing:border-box}body{margin:0;font-family:Arial;--bg-card:#fff;--primary-text:#222;--secondary-text:#666;--divider:#ddd}
    #root{height:100vh;display:flex}button{cursor:pointer;padding:5px}button:disabled{cursor:default}.cw-error{color:#a22;padding:8px}
  </style><div id="root"></div><script type="module" src="/creation-native-input-browser.jsx"></script></html>`;
  server = await createServer({
    configFile: false, root: `${root}tests/fixtures`, appType: "custom", logLevel: "warn",
    cacheDir: `${root}node_modules/.vite/creation-native-input`, resolve: { alias: { "@": `${root}src` } },
    css: { postcss: { plugins: [] } },
    optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", "react-dom", "zod", "lucide-react", "@univerjs/presets", "@univerjs/preset-sheets-core", "@univerjs/preset-sheets-core/worker", "@univerjs/core", "@univerjs/sheets-ui"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root] } },
    plugins: [{ name: "native-input-fixture", configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); }
        else if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); }
        else next();
      });
    } }],
  });
  await server.listen(); baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
});
test.afterAll(async () => { await server?.close(); });

test("unfinished real Univer cell survives reload as a local backup, with explicit review and confirmed save", async ({ page }, info) => {
  let content = toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "输入恢复验证", sheets: [{ id: "s", name: "预算", cells: [{ id: "c", address: "B2", value: "原始文字" }] }] }, "fixture-unit"), revision = 1;
  const saves = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("dialog", dialog => dialog.accept());
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== baseURL) return route.abort();
    if (url.pathname === "/api/creation/artifacts/fixture-sheet/native") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON(); expect(body.baseRevision).toBe(revision);
        saves.push(body); content = body.content; revision++;
        return route.fulfill({ json: { artifactId: "fixture-sheet", baseRevision: revision - 1, revision } });
      }
      return route.fulfill({ json: { id: "fixture-sheet", revision, content } });
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(baseURL);
  const status = page.locator(".cw-native-toolbar [role=status]");
  await expect(status).toContainText("已保存");
  await expect(page.locator('.cw-native-office [data-u-comp="workbench-skeleton-content"]')).toHaveCount(0);
  const address = page.locator('.cw-native-office [data-u-comp="defined-name"] input');
  await address.fill("B2"); await address.press("Enter"); await page.keyboard.press("F2");
  await page.keyboard.press("Control+A"); await page.keyboard.insertText("还没按回车的中文文字");
  await expect(status).toContainText("输入待确认");
  const inputs = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("modelshot-creation-drafts", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise((resolve, reject) => { const request = db.transaction("documents").objectStore("documents").getAll(); request.onsuccess = () => resolve(request.result.flatMap(row => row.textDraft?.format === "univer-sheet-input-1" ? row.textDraft.entries : [])); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  });
  await expect.poll(async () => (await inputs())[0]?.text).toBe("还没按回车的中文文字");
  expect(saves).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "备份文字", exact: true })).toHaveValue("还没按回车的中文文字");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(content.snapshot.sheets.sheet0.cellData[1][1].v).toBe("原始文字");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "下载全部备份" }).click();
  const download = await downloading;
  expect(await readFile(await download.path(), "utf8")).toContain("还没按回车的中文文字");
  await page.screenshot({ path: info.outputPath("native-input-recovered.png") });
  await page.getByRole("button", { name: "继续编辑并清除备份" }).click();
  await expect(page.getByRole("textbox", { name: "备份文字", exact: true })).toHaveCount(0);
  await address.fill("B2"); await address.press("Enter"); await page.keyboard.press("F2");
  await page.keyboard.press("Control+A"); await page.keyboard.insertText("确认后的文字");
  await expect.poll(async () => (await inputs())[0]?.text).toBe("确认后的文字");
  await page.keyboard.press("Enter"); await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(status).toContainText("已保存 · V2");
  expect(content.snapshot.sheets.sheet0.cellData[1][1].v).toBe("确认后的文字");
  await expect.poll(inputs).toEqual([]);
  await page.reload(); await expect(status).toContainText("已保存 · V2");
  await expect(page.getByRole("textbox", { name: "备份文字", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
