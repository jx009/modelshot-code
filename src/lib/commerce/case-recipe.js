export function caseRecipe(item, locale = "zh") {
  const zh = locale === "zh";
  return {
    prompt: zh ? item.brief : item.briefEn,
    fixedPrompt: zh ? "保持参考图的主体身份、比例和可见标识。以专业商业摄影呈现，光影自然，排版留白，避免未经确认的产品卖点。" : "Preserve the reference subject, proportions and visible markings. Professional commercial photography, natural light and deliberate negative space. No unsupported product claims.",
    size: item.category === "space" ? "1536x1024" : "1024x1536",
    outputCount: 1,
    mode: "quick",
    reference: item.image,
  };
}
