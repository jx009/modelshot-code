export function imageEditStrategy(config = {}) {
  if ((config.imageKind || "openai") !== "openai") return "reference-guide";
  if (!config.baseURL) return "native-mask";
  try { return new URL(config.baseURL).origin === "https://api.openai.com" ? "native-mask" : "reference-guide"; }
  catch { return "reference-guide"; }
}
