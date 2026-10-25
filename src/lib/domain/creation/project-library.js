import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

const kinds = ["all", "trash", "canvas", "commerce", "poster", "slides", "document", "sheet", "web"];
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
function decode(raw, kind, q) {
  if (!raw) return null;
  try {
    if (raw.length > 2048) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (value.version !== 1 || value.kind !== kind || value.q !== q || !idPattern.test(value.id) || !["creation", "studio"].includes(value.source) || !Number.isFinite(Date.parse(value.date))) throw new Error();
    return { ...value, date: new Date(value.date) };
  } catch { throw new AppError("INVALID_CURSOR"); }
}
// Two bounded metadata queries are merged using the same total ordering. Never
// load document JSON, revisions, messages or per-project counts for a list card.
export async function listProjectLibrary(userId, { kind = "all", q = "", cursor: raw, allowedKinds } = {}, db = prisma) {
  kind ||= "all"; q = q.trim().slice(0, 100);
  if (!kinds.includes(kind)) throw new AppError("INVALID_PROJECT_KIND");
  const cursor = decode(raw, kind, q), limit = 24;
  const where = source => ({ userId, deletedAt: kind === "trash" ? { not: null } : null,
    ...(source === "creation" && allowedKinds ? { AND: [{ kind: { in: allowedKinds } }] } : {}),
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    ...(!["all", "trash"].includes(kind) ? { kind } : {}),
    ...(cursor ? { OR: [{ updatedAt: { lt: cursor.date } }, { updatedAt: cursor.date, id: { lt: cursor.id } },
      ...(source < cursor.source ? [{ updatedAt: cursor.date, id: cursor.id }] : [])] } : {}),
  });
  const orderBy = [{ updatedAt: "desc" }, { id: "desc" }];
  const [studio, creation] = await Promise.all([
    ["all", "trash", "canvas", "commerce"].includes(kind) ? db.studioDocument.findMany({ where: where("studio"), orderBy, take: limit + 1,
      select: { id: true, name: true, version: true, updatedAt: true, kind: true, coverAssetId: true, itemCount: true } }) : [],
    !["canvas", "commerce"].includes(kind) ? db.creationProject.findMany({ where: where("creation"), orderBy, take: limit + 1,
      select: { id: true, name: true, updatedAt: true, kind: true, coverAssetId: true } }) : [],
  ]);
  const rows = [...studio.map(({ itemCount, ...row }) => ({ ...row, source: "studio", count: itemCount })), ...creation.map(row => ({ ...row, source: "creation" }))]
    .sort((a, b) => +b.updatedAt - +a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : a.source < b.source ? 1 : a.source > b.source ? -1 : 0));
  const items = rows.slice(0, limit), last = items.at(-1);
  return { items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ version: 1, kind, q, date: last.updatedAt, id: last.id, source: last.source })).toString("base64url") : null };
}
