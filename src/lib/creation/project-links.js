export function isCreationProject(row) { return row.source === "creation"; }
export function projectIdentity(row) { return `${isCreationProject(row) ? "creation" : "studio"}:${row.id}`; }
export function projectHref(row) {
  return isCreationProject(row) ? `/creation?project=${encodeURIComponent(row.id)}` : `/${row.kind === "commerce" ? "commerce" : "studio-v2"}?document=${encodeURIComponent(row.id)}`;
}
