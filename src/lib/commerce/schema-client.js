const ENUMS = {
  platform: ["taobao", "amazon", "shopify"], region: ["CN", "US", "EU"], language: ["zh", "en"],
  style: ["natural", "editorial", "studio"], theme: ["linen", "sand", "red", "ice", "mono", "citrus", "dark"],
  kind: ["hero", "benefit", "detail", "lifestyle", "specs", "closing"], layout: ["cover", "split", "inset"], planning: ["template", "vision"],
};
export const THEMES = {
  linen: { background: "#eeebe3", text: "#383a31", muted: "#717362", accent: "#9a7250" }, sand: { background: "#e7decd", text: "#423728", muted: "#806e57", accent: "#a87843" },
  red: { background: "#ab111e", text: "#fff4e8", muted: "#edc5c6", accent: "#ffcfa8" }, ice: { background: "#dbe9ed", text: "#27434d", muted: "#55717a", accent: "#8d6345" },
  mono: { background: "#eaeaea", text: "#202627", muted: "#5e6565", accent: "#727e7d" }, citrus: { background: "#f0b22d", text: "#53371d", muted: "#77532c", accent: "#984b1a" },
  dark: { background: "#17191a", text: "#f0ede6", muted: "#acafa6", accent: "#cbb78d" },
};
export const outputWidth = platform => ({ taobao: 750, amazon: 970, shopify: 1200 })[platform] || 750;
const defaults = { brand: "", description: "", material: "", dimensions: "", audience: "", scenario: "", platform: "taobao", region: "CN", language: "zh", style: "natural", theme: "linen", caseId: "" };
function invalid(message) { const error = new Error(message); error.issues = [{ message }]; return error; }
export function normalizeBrief(value = {}, { partial = false } = {}) {
  const brief = { ...defaults, ...value };
  if (!partial && !String(brief.product || "").trim()) throw invalid("PRODUCT_REQUIRED");
  for (const [key, values] of Object.entries(ENUMS)) if (key in brief && values.includes(brief[key]) === false) throw invalid(`INVALID_${key.toUpperCase()}`);
  for (const [key, max] of [["product", 80], ["brand", 60], ["description", 2400], ["material", 200], ["dimensions", 200], ["audience", 200], ["scenario", 200], ["caseId", 80]]) if (String(brief[key] || "").length > max) throw invalid(`TOO_LONG_${key.toUpperCase()}`);
  return brief;
}
export const briefSchema = {
  parse: value => normalizeBrief(value),
  safeParse: value => { try { return { success: true, data: normalizeBrief(value) }; } catch (error) { return { success: false, error }; } },
  partial: () => ({ safeParse: value => { try { return { success: true, data: normalizeBrief(value, { partial: true }) }; } catch (error) { return { success: false, error }; } } }),
};
export function normalizeCommerce(value = {}) {
  const brief = normalizeBrief(value.brief);
  if (value.version !== 1 || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 10) throw invalid("INVALID_COMMERCE");
  const sections = value.sections.map(section => {
    if (!section?.id || !ENUMS.kind.includes(section.kind) || !ENUMS.layout.includes(section.layout) || !String(section.title || "").trim()) throw invalid("INVALID_SECTION");
    return { ...section, attempt: Number.isInteger(section.attempt) ? section.attempt : 0 };
  });
  if (new Set(sections.map(section => section.id)).size !== sections.length) throw invalid("DUPLICATE_SECTION");
  if (value.planning && !ENUMS.planning.includes(value.planning)) throw invalid("INVALID_PLANNING");
  return { ...value, version: 1, brief, sections, planning: value.planning || "template" };
}
export const commerceSchema = {
  parse: value => normalizeCommerce(value),
  safeParse: value => { try { return { success: true, data: normalizeCommerce(value) }; } catch (error) { return { success: false, error }; } },
};
