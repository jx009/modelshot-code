export const REMOVED_REFERENCE = "[removed-reference]";

// Rewrite only explicit references; ordinary dimensions, dates and counts stay intact.
export function remapImageReferences(text = "", previousIds = [], nextIds = []) {
  return text.replace(/(图\s*|@|\bimage\s+)([1-9]\d*)(?!\d)/gi, (match, prefix, number) => {
    const id = previousIds[Number(number) - 1];
    if (!id) return match;
    const index = nextIds.indexOf(id);
    return index < 0 ? REMOVED_REFERENCE : `${prefix}${index + 1}`;
  });
}
