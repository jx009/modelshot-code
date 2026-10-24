import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";

export const PROJECT_FILES_PAGE_SIZE = 24;
export const projectFileFields = { id: true, name: true, kind: true, currentRevision: true, updatedAt: true };
export const projectFileOrder = [{ updatedAt: "desc" }, { id: "desc" }];

export function projectFilePage(projectId, rows, q = "") {
  const items = rows.slice(0, PROJECT_FILES_PAGE_SIZE), last = items.at(-1);
  return { items, nextCursor: rows.length > PROJECT_FILES_PAGE_SIZE
    ? Buffer.from(JSON.stringify({ version: 1, projectId, q, id: last.id, date: last.updatedAt })).toString("base64url") : null };
}

function decodeCursor(projectId, raw, q) {
  if (!raw) return null;
  try {
    if (typeof raw !== "string" || raw.length > 1024) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (value.version !== 1 || value.projectId !== projectId || (value.q ?? "") !== q || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id)
      || typeof value.date !== "string" || !Number.isFinite(Date.parse(value.date))) throw new Error();
    return { id: value.id, date: new Date(value.date) };
  } catch { throw new AppError("INVALID_CURSOR"); }
}

export async function listProjectFiles(userId, projectId, options, db = prisma) {
  // Retain old unfiltered cursor callers, including already opened workspaces.
  const { cursor, q: rawQuery = "" } = typeof options === "string" || options == null ? { cursor: options } : options;
  if (typeof rawQuery !== "string" || rawQuery.length > 100) throw new AppError("INVALID_PAYLOAD");
  const q = rawQuery.trim(), after = decodeCursor(projectId, cursor, q);
  const project = await db.creationProject.findFirst({ where: { id: projectId, userId, deletedAt: null }, select: { id: true } });
  if (!project) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
  const rows = await db.creationArtifact.findMany({
    where: { projectId, deletedAt: null, project: { userId, deletedAt: null },
      ...(q ? { name: { contains: q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" } } : {}),
      ...(after ? { OR: [{ updatedAt: { lt: after.date } }, { updatedAt: after.date, id: { lt: after.id } }] } : {}),
    },
    select: projectFileFields, orderBy: projectFileOrder, take: PROJECT_FILES_PAGE_SIZE + 1,
  });
  return projectFilePage(projectId, rows, q);
}
