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
for (const locale of ["en", "zh"]) {
  const other = locale === "en" ? "zh" : "en";
  for (const [key, value] of catalogs[locale]) {
    if (!catalogs[other].has(key)) errors.push(`${other}: missing ${key}`);
    if (!value.trim() && !allowedEmpty.has(key)) errors.push(`${locale}: empty ${key}`);
    if (locale === "en" && /\p{Script=Han}/u.test(value)) errors.push(`en: unexpected Chinese text at ${key}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS translation catalogs (${catalogs.en.size} keys per locale)`);
}
