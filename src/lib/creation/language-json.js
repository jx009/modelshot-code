// Accommodate one exact Markdown JSON wrapper, not arbitrary prose, partial
// JSON, guessed missing fields or executable JavaScript.
export function parseLanguageJson(value) {
  let text = value.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  const result = JSON.parse(text);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("LANGUAGE_RESULT_INVALID");
  return result;
}
