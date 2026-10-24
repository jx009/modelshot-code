import { prisma } from "../../prisma.js";
import { AppError } from "../../http.js";
import { lockUser } from "../billing/ledger.js";
import { createProjectSchema } from "../../creation/contracts/projects.js";
import { RUN_ACTIVE, RUN_WAITING } from "../../creation/contracts/runs.js";
import { PROJECT_FILES_PAGE_SIZE, projectFileFields, projectFileOrder, projectFilePage } from "./project-files.js";

const fields = { id: true, name: true, kind: true, coverAssetId: true, createdAt: true, updatedAt: true };
export function requireCreationWorkspace(env = process.env) {
  if (env.CREATION_WORKSPACE_ENABLED !== "true") throw new AppError("CREATION_NOT_ENABLED", 503);
}
export async function updateProject(userId, id, input, db = prisma) {
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const row = await tx.creationProject.findFirst({ where: { id, userId } });
    if (!row) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    if (input.remove) {
      if (await tx.creationRun.count({ where: { projectId: id, status: { in: [...RUN_ACTIVE, ...RUN_WAITING] } } })) throw new AppError("CREATION_PROJECT_BUSY", 409);
      return tx.creationProject.update({ where: { id }, data: { deletedAt: row.deletedAt || new Date() }, select: fields });
    }
    if (input.restore) return tx.creationProject.update({ where: { id }, data: { deletedAt: null }, select: fields });
    if (row.deletedAt) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    if (+row.updatedAt !== +new Date(input.updatedAt)) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409);
    return tx.creationProject.update({ where: { id }, data: { name: input.name }, select: fields });
  });
}
export async function createProject(userId, input, db = prisma) {
  const data = createProjectSchema.parse(input);
  return db.$transaction(async tx => {
    await lockUser(tx, userId);
    const old = await tx.creationProject.findUnique({ where: { userId_createKey: { userId, createKey: data.createKey } } });
    if (old?.deletedAt) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
    if (old) {
      if (old.kind !== data.kind) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      return readProject(userId, old.id, tx);
    }
    const project = await tx.creationProject.create({ data: { userId, ...data, sessions: { create: { title: data.name } } } });
    return readProject(userId, project.id, tx);
  });
}

export async function readProject(userId, id, db = prisma) {
  const project = await db.creationProject.findFirst({ where: { id, userId, deletedAt: null }, select: {
    ...fields, sessions: { take: 24, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, title: true, updatedAt: true } },
    artifacts: { where: { deletedAt: null }, take: PROJECT_FILES_PAGE_SIZE + 1, orderBy: projectFileOrder, select: projectFileFields },
  } });
  if (!project) throw new AppError("CREATION_PROJECT_NOT_FOUND", 404);
  const files = projectFilePage(id, project.artifacts);
  return { ...project, artifacts: files.items, artifactsNextCursor: files.nextCursor };
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    if (raw.length > 512) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value.id) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error();
    return { id: value.id, updatedAt: new Date(value.updatedAt) };
  } catch { throw new AppError("INVALID_CURSOR"); }
}

export async function listProjects(userId, { cursor: raw, kind } = {}, db = prisma) {
  const cursor = decodeCursor(raw);
  if (kind && !["poster", "slides", "document", "sheet", "web"].includes(kind)) throw new AppError("INVALID_PROJECT_KIND");
  const rows = await db.creationProject.findMany({
    where: { userId, deletedAt: null, ...(kind ? { kind } : {}), ...(cursor ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 25, select: fields,
  });
  const items = rows.slice(0, 24), last = items.at(-1);
  return { items, nextCursor: rows.length > 24 ? Buffer.from(JSON.stringify({ id: last.id, updatedAt: last.updatedAt })).toString("base64url") : null };
}

export async function readMessages(userId, sessionId, before, db = prisma) {
  const session = await db.creationSession.findFirst({ where: { id: sessionId, project: { userId, deletedAt: null } }, select: { id: true } });
  if (!session) throw new AppError("CREATION_SESSION_NOT_FOUND", 404);
  if (before !== undefined && (!Number.isInteger(before) || before < 1)) throw new AppError("INVALID_CURSOR");
  const rows = await db.creationMessage.findMany({ where: { sessionId, ...(before ? { sequence: { lt: before } } : {}) }, orderBy: { sequence: "desc" }, take: 51,
    select: { id: true, sequence: true, role: true, text: true, references: true, createdAt: true },
  });
  return { items: rows.slice(0, 50).reverse(), nextCursor: rows.length > 50 ? rows[49].sequence : null };
}
