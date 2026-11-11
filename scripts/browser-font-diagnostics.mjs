import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("font-diagnostics", { recursive: true });
const report = {
  environment: Object.fromEntries(["LANG", "LC_ALL", "FONTCONFIG_FILE", "FONTCONFIG_PATH", "LD_LIBRARY_PATH"].map(key => [key, process.env[key] || null])),
  font: execFileSync("fc-match", ["-f", "%{file}\n%{family}\n", "Noto Sans CJK SC"], { encoding: "utf8" }),
  variants: [],
};
const variants = [
  ["bundled", { channel: "chromium" }],
  ["explicit-fontconfig", { channel: "chromium", env: { ...process.env, FONTCONFIG_FILE: "/etc/fonts/fonts.conf", FONTCONFIG_PATH: "/etc/fonts", LD_LIBRARY_PATH: "" } }],
  ...(existsSync("/usr/bin/google-chrome") ? [["system-chrome", { executablePath: "/usr/bin/google-chrome" }]] : []),
];
for (const [name, options] of variants) {
  const browser = await chromium.launch({ headless: true, ...options });
  try {
    const page = await browser.newPage({ locale: "zh-CN" });
    await page.setContent('<html lang="zh"><body><p id="sample" style="font:24px &quot;Noto Sans CJK SC&quot;,sans-serif">中文字体对照</p></body></html>');
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#sample" });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    report.variants.push({ name, version: browser.version(), fonts });
    await page.screenshot({ path: `font-diagnostics/${name}.png` });
  } finally { await browser.close(); }
}
await writeFile("font-diagnostics/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
