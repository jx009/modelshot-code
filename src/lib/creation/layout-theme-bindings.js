// Materialized paint/font values remain authoritative for rendering/export.
// Roles control future theme changes; missing roles retain legacy matching.
export const textThemeFields = { fill: "fillRole", fontFamily: "fontRole" };
export const shapeThemeFields = { fill: "fillRole", stroke: "strokeRole" };
export const pageThemeFields = { background: "backgroundRole" };

export function applyBoundStyle(previous, patch, theme, fields) {
  const next = { ...previous, ...patch };
  for (const [field, roleField] of Object.entries(fields)) {
    if (Object.hasOwn(patch, roleField)) {
      const role = patch[roleField];
      if (role === null) delete next[roleField];
      // Undo may carry both an exact previous value and its binding. Preserve
      // that value even when a locked object missed an intervening theme change.
      else if (role !== "custom" && !Object.hasOwn(patch, field)) next[field] = theme[role === "theme" ? "fontFamily" : role];
    } else if (Object.hasOwn(patch, field)) next[roleField] = "custom";
  }
  return next;
}

export function inverseBoundStyle(previous, patch, fields) {
  const inverse = Object.fromEntries(Object.keys(patch).map(key => [key, previous[key] ?? null]));
  for (const [field, roleField] of Object.entries(fields)) {
    if (Object.hasOwn(patch, field) || Object.hasOwn(patch, roleField)) {
      inverse[field] = previous[field];
      inverse[roleField] = previous[roleField] ?? null;
    }
  }
  return inverse;
}
