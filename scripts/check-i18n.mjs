import { readFile } from "node:fs/promises";

function flatten(value, prefix = "", result = new Map()) {
  if (typeof value === "string") {
    result.set(prefix, value);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    throw new Error(`Invalid translation value: ${prefix}`);
  }
  return result;
}

const catalogs = {};
for (const locale of ["en", "zh"]) {
  catalogs[locale] = flatten(JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")));
}
const errors = [];
// The first comparison column is a row-label header, intentionally blank.
const allowedEmpty = new Set(["landing.compareCols.0"]);
// The product's proper name stays the same in both languages. All other
// English copy must still pass the Chinese-text check.
const brandKeys = new Set(["login.title", "footer.copyright", "meta.title", "landing.compareTitle", "landing.compareCols.2"]);
for (const locale of ["en", "zh"]) {
  const other = locale === "en" ? "zh" : "en";
  for (const [key, value] of catalogs[locale]) {
    if (!catalogs[other].has(key)) errors.push(`${other}: missing ${key}`);
    if (!value.trim() && !allowedEmpty.has(key)) errors.push(`${locale}: empty ${key}`);
    const prose = brandKeys.has(key) ? value.replaceAll("来塔绘梦", "") : value;
    if (locale === "en" && /\p{Script=Han}/u.test(prose)) errors.push(`en: unexpected Chinese text at ${key}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS translation catalogs (${catalogs.en.size} keys per locale)`);
}
