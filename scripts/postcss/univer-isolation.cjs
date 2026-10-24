// Build-time only. Do not add observers, rewrite styles in the browser, or
// change styles from the existing app. Next loads this plugin by filename.
const vendorFile = /\/node_modules\/@univerjs\/preset-(docs|sheets)-core\/lib\/index\.css$/;
const scope = ':where(.cw-native-office, .cw-native-office *, [class*="univer-"], [class*="univer-"] *)';
function isKeyframe(rule) {
  for (let parent = rule.parent; parent; parent = parent.parent) if (parent.type === "atrule" && /keyframes$/i.test(parent.name)) return true;
  return false;
}
function scopedSelector(selector, rule) {
  const value = selector.trim();
  if (value.startsWith(scope)) return value;
  if (value === "*") return scope;
  if ([":before", "::before", ":after", "::after", "::backdrop"].includes(value)) return `${scope}${value}`;
  // Vendor namespaced classes already isolate normal UI and body portals.
  if (value.includes(".univer-")) return value;
  // The pinned preset also has arbitrary-value utilities without its prefix.
  // Prepend a zero-specificity same-element constraint so their precedence
  // stays unchanged inside the editor but they cannot match the old canvas.
  if (value.startsWith(".")) return `${scope}${value}`;
  throw rule.error(`Unreviewed global Univer selector: ${value}`);
}
module.exports = () => ({
  postcssPlugin: "modelshot-univer-isolation",
  Once(root) {
    const file = root.source?.input?.file?.replaceAll("\\", "/");
    if (!file || !vendorFile.test(file)) return;
    root.walkRules(rule => {
      if (isKeyframe(rule)) return;
      rule.selectors = rule.selectors.map(selector => scopedSelector(selector, rule));
    });
    // The presets use generic enter/exit keyframes, which otherwise collide
    // with application animations even after selector scoping.
    root.walkAtRules(/keyframes$/i, rule => {
      if (["enter", "exit"].includes(rule.params)) rule.params = `cw-native-${rule.params}`;
      else if (!rule.params.startsWith("univer-") && !rule.params.startsWith("cw-native-")) throw rule.error(`Unreviewed Univer animation: ${rule.params}`);
    });
    root.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/, declaration => {
      declaration.value = declaration.value.replace(/\b(enter|exit)\b/g, (name, _group, offset, value) => value.slice(Math.max(0, offset - 10), offset).endsWith("cw-native-") ? name : `cw-native-${name}`);
    });
  },
});
module.exports.postcss = true;
