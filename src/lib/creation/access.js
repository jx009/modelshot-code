import { z } from "zod";
import { prisma } from "../prisma.js";
import { getSiteConfig } from "../site-config.js";
import { AppError } from "../http.js";
import { CREATION_ACCESS_FLAGS, CREATION_CONTENT_KINDS, RETIRED_CREATION_KINDS } from "./access-flags.js";

export const creationAccessSchema = z.object(Object.fromEntries(CREATION_ACCESS_FLAGS.map(({ key }) => [key, z.boolean()]))).strict();

export async function getCreationAccessConfig(db = prisma, env = process.env) {
  const raw = await getSiteConfig("creation_access", db);
  if (raw) {
    // Invalid stored configuration fails closed, rather than silently reopening a feature.
    // Retired kinds are dropped explicitly; any other unknown key still fails closed.
    try {
      const stored = JSON.parse(raw);
      for (const kind of RETIRED_CREATION_KINDS) delete stored?.[kind];
      return creationAccessSchema.parse({ video: false, motion: false, ...stored });
    }
    catch { throw new AppError("CREATION_CONFIG_INVALID", 503); }
  }
  return Object.fromEntries(CREATION_ACCESS_FLAGS.map(({ key, env: name }) => [key, env[name] === "true"]));
}

export function effectiveCreationEnv(config, user, env = process.env) {
  if (!user || user.status !== "active") throw new AppError("FORBIDDEN", 403);
  return { ...env, ...Object.fromEntries(CREATION_ACCESS_FLAGS.map(({ key, env: name }) => [name, user.role === "root" || config[key] ? "true" : "false"])) };
}

export async function getCreationEnv(userId, { db = prisma, env = process.env } = {}) {
  const [config, user] = await Promise.all([
    getCreationAccessConfig(db, env),
    db.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
  ]);
  return effectiveCreationEnv(config, user, env);
}

export function assertCreationAccess(env, { kind, workspace = kind !== "image", runs = false } = {}) {
  if (RETIRED_CREATION_KINDS.includes(kind)) throw new AppError("CREATION_NOT_ENABLED", 403);
  const flag = CREATION_ACCESS_FLAGS.find(item => item.key === kind);
  if ((workspace && env.CREATION_WORKSPACE_ENABLED !== "true")
    || (runs && env.CREATION_RUNS_ENABLED !== "true")
    || (flag && env[flag.env] !== "true")) throw new AppError("CREATION_NOT_ENABLED", 403);
}

export function allowedCreationKinds(env) {
  return CREATION_CONTENT_KINDS.filter(kind => {
    try { assertCreationAccess(env, { kind }); return true; } catch { return false; }
  });
}

// Resolve the actual owned resource kind; never trust a query/body kind for an
// existing resource. Authorization remains in force for direct links and edits.
export async function assertCreationResource(userId, env, resource, id, db = prisma) {
  if (typeof id !== "string" || !id) throw new AppError("CREATION_RESOURCE_NOT_FOUND", 404);
  let row, kind;
  if (resource === "project") {
    row = await db.creationProject.findFirst({ where: { id, userId }, select: { kind: true } });
    kind = row?.kind;
  } else if (resource === "session") {
    row = await db.creationSession.findFirst({ where: { id, project: { userId } }, select: { project: { select: { kind: true } } } });
    kind = row?.project.kind;
  } else if (resource === "artifact") {
    row = await db.creationArtifact.findFirst({ where: { id, project: { userId } }, select: { kind: true, project: { select: { kind: true } } } });
    kind = row?.kind;
  } else if (resource === "run") {
    row = await db.creationRun.findFirst({ where: { id, userId }, select: { kind: true, project: { select: { kind: true } } } });
    kind = row?.kind;
  } else if (resource === "import") {
    row = await db.creationImport.findFirst({ where: { id, userId }, select: { project: { select: { kind: true } } } });
    kind = row?.project.kind;
  } else if (resource === "export") {
    row = await db.artifactExport.findFirst({ where: { id, userId }, select: { revision: { select: { artifact: { select: { kind: true, project: { select: { kind: true } } } } } } } });
    kind = row?.revision.artifact.kind;
    if (row) assertCreationAccess(env, { kind: row.revision.artifact.project.kind });
  } else throw new AppError("INVALID_CREATION_RESOURCE", 400);
  if (!row) throw new AppError("CREATION_RESOURCE_NOT_FOUND", 404);
  assertCreationAccess(env, { kind });
  if (row.project) assertCreationAccess(env, { kind: row.project.kind });
}
