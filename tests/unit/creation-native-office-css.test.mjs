import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import isolate from "../../scripts/postcss/univer-isolation.cjs";
import config from "../../postcss.config.mjs";

const file = kind => fileURLToPath(new URL(`../../node_modules/@univerjs/preset-${kind}-core/lib/index.css`, import.meta.url));
const transform = (css, from = file("docs")) => postcss([isolate()]).process(css, { from, map: false });
it("registers isolation before the existing Tailwind pipeline and leaves all app CSS byte-for-byte untouched", async () => {
  expect(Object.keys(config.plugins)[0].replaceAll("\\", "/")).toMatch(/scripts\/postcss\/univer-isolation.cjs$/);
  expect(config.plugins["@tailwindcss/postcss"]).toEqual({});
  const css = '* { scrollbar-width: thin; } .canvas { color: red; } @keyframes enter { from { opacity: 0; } }';
  for (const from of ["C:/jxProject/modelshot-code/src/app/globals.css", "/node_modules/unrelated/lib/index.css"]) expect((await transform(css, from)).css).toBe(css);
});

it("scopes the installed Docs and Sheets global rules without changing declarations or keyframe geometry", async () => {
  for (const kind of ["docs", "sheets"]) {
    const source = await readFile(file(kind), "utf8"), original = postcss.parse(source), result = await transform(source, file(kind));
    const before = [], after = [], keyframes = [];
    original.walkDecls(d => before.push([d.prop, d.value])); result.root.walkDecls(d => after.push([d.prop, d.value]));
    expect(after.length).toBe(before.length);
    for (let index = 0; index < before.length; index++) {
      const [prop, value] = before[index];
      expect(after[index]).toEqual([prop, /^(?:-webkit-)?animation(?:-name)?$/.test(prop) ? value.replace(/\b(enter|exit)\b/g, "cw-native-$1") : value]);
    }
    result.root.walkAtRules("keyframes", rule => keyframes.push(rule.params));
    expect(keyframes).not.toContain("enter"); expect(keyframes).not.toContain("exit");
    expect(keyframes).toContain("cw-native-enter");
    expect((await transform(result.css, file(kind))).css).toBe(result.css);
    expect(result.warnings()).toHaveLength(0);
    const selectors = [];
    result.root.walkRules(rule => { if (rule.parent.type !== "atrule" || !rule.parent.name.endsWith("keyframes")) selectors.push(...rule.selectors); });
    expect(selectors.every(selector => selector.includes("univer-") || selector.includes(".cw-native-office"))).toBe(true);
  }
});

it("keeps resets/arbitrary utility selectors off the old UI but matches editor children and body portals", async () => {
  const css = '* { scrollbar-width: initial; } .\\[color\\:red\\] { color: red; } .univer-button { display: flex; }';
  const result = await transform(css);
  const dom = new JSDOM('<main id="old" class="[color:red]"><button id="old-button">Old</button></main><section class="cw-native-office"><button id="native" class="[color:red]">Native</button></section><aside class="univer-menu"><button id="portal" class="[color:red]">Popup</button></aside>');
  try {
    const document = dom.window.document, resets = result.root.nodes[0].selector, arbitrary = result.root.nodes[1].selector;
    expect(document.querySelector("#old").matches(resets)).toBe(false);
    expect(document.querySelector("#old-button").matches(resets)).toBe(false);
    expect(document.querySelector("#old").matches(arbitrary)).toBe(false);
    expect(document.querySelector("#native").matches(resets)).toBe(true);
    expect(document.querySelector("#portal").matches(arbitrary)).toBe(true);
    expect(result.root.nodes[2].selector).toBe(".univer-button");
  } finally { dom.window.close(); }
});

it("keeps the workbench's generic form-control styling off native toolbars", async () => {
  const css = await readFile(new URL("../../src/components/creation/creation.css", import.meta.url), "utf8");
  const root = postcss.parse(css), dom = new JSDOM('<main class="cw-workspace"><button id="old">Save</button><section class="cw-native-office"><button id="native">Native toolbar</button></section></main>');
  try {
    const rules = root.nodes.filter(rule => rule.type === "rule" && rule.selector.startsWith(".cw-workspace ") && rule.selector.includes(".cw-native-office"));
    expect(rules.length).toBe(5);
    const base = rules.find(rule => rule.selector.startsWith(".cw-workspace button:not("));
    expect(dom.window.document.querySelector("#old").matches(base.selector)).toBe(true);
    expect(dom.window.document.querySelector("#native").matches(base.selector)).toBe(false);
  } finally { dom.window.close(); }
});

it("requires a review if a future preset adds new unscoped element rules or animation names", async () => {
  await expect(transform("body { background: black }" )).rejects.toThrow("Unreviewed global Univer selector");
  await expect(transform("@keyframes spin { from { opacity: 0 } }" )).rejects.toThrow("Unreviewed Univer animation");
});
