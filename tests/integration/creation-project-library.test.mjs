import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { domainFixture } from "../support/domain-fixture.mjs";
import { listProjectLibrary } from "../../src/lib/domain/creation/project-library.js";
import { readProject, updateProject } from "../../src/lib/domain/creation/projects.js";
import { listProjectFiles } from "../../src/lib/domain/creation/project-files.js";

let fixture;
const users = [];
beforeAll(async () => { fixture = await domainFixture(); });
afterAll(async () => {
  if (!fixture) return;
  await fixture.db.creationRun.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.creationProject.deleteMany({ where: { userId: { in: users } } });
  await fixture.db.studioDocument.deleteMany({ where: { userId: { in: users } } });
  await fixture.cleanup();
});
async function user() { const row = await fixture.user(); users.push(row.id); return row; }

it("paginates tied timestamps and cross-table ID collisions without duplicate or missing projects", async () => {
  const owner = await user(), stranger = await user(), date = new Date("2026-10-24T00:00:00Z"), prefix = randomUUID();
  const ids = Array.from({ length: 15 }, (_, index) => `${prefix}-${String(index).padStart(2, "0")}`);
  await fixture.db.studioDocument.createMany({ data: ids.map(id => ({ id, userId: owner.id, name: "Canvas", kind: "canvas", content: { secret: "not list metadata" }, updatedAt: date })) });
  await fixture.db.creationProject.createMany({ data: ids.map(id => ({ id, userId: owner.id, createKey: randomUUID(), name: "Poster", kind: "poster", updatedAt: date })) });
  await fixture.db.creationProject.create({ data: { userId: stranger.id, createKey: randomUUID(), name: "Private", kind: "poster", updatedAt: date } });
  const first = await listProjectLibrary(owner.id, {}, fixture.db);
  const second = await listProjectLibrary(owner.id, { cursor: first.nextCursor }, fixture.db);
  expect(first.items).toHaveLength(24); expect(second.items).toHaveLength(6); expect(second.nextCursor).toBeNull();
  const rows = [...first.items, ...second.items];
  expect(new Set(rows.map(row => `${row.source}:${row.id}`)).size).toBe(30);
  expect(rows.every(row => !Object.hasOwn(row, "content"))).toBe(true);
  expect(rows.some(row => row.name === "Private")).toBe(false);
  await expect(listProjectLibrary(owner.id, { kind: "poster", cursor: first.nextCursor }, fixture.db)).rejects.toThrow("INVALID_CURSOR");
  const posters = await listProjectLibrary(owner.id, { kind: "poster" }, fixture.db);
  expect(posters.items).toHaveLength(15); expect(posters.items.every(row => row.source === "creation")).toBe(true);
});

it("uses optimistic rename, retains deleted projects for restoration, and denies deletion during an active run", async () => {
  const owner = await user(), stranger = await user();
  const row = await fixture.db.creationProject.create({ data: { userId: owner.id, createKey: randomUUID(), name: "Original", kind: "slides" } });
  await expect(updateProject(stranger.id, row.id, { remove: true }, fixture.db)).rejects.toThrow("CREATION_PROJECT_NOT_FOUND");
  await expect(updateProject(owner.id, row.id, { name: "Stale", updatedAt: "2020-01-01T00:00:00Z" }, fixture.db)).rejects.toThrow("DOCUMENT_VERSION_CONFLICT");
  await updateProject(owner.id, row.id, { name: "New title", updatedAt: row.updatedAt.toISOString() }, fixture.db);
  const run = await fixture.db.creationRun.create({ data: { userId: owner.id, projectId: row.id, requestId: randomUUID(), digest: "fixture", kind: "slides", input: {}, maxCredits: 0, status: "awaiting_budget" } });
  await expect(updateProject(owner.id, row.id, { remove: true }, fixture.db)).rejects.toThrow("CREATION_PROJECT_BUSY");
  await fixture.db.creationRun.update({ where: { id: run.id }, data: { status: "cancelled" } });
  await updateProject(owner.id, row.id, { remove: true }, fixture.db);
  expect((await listProjectLibrary(owner.id, {}, fixture.db)).items).toHaveLength(0);
  expect((await listProjectLibrary(owner.id, { kind: "trash" }, fixture.db)).items[0].name).toBe("New title");
  await updateProject(owner.id, row.id, { restore: true }, fixture.db);
  expect((await listProjectLibrary(owner.id, { q: "title" }, fixture.db)).items[0].id).toBe(row.id);
});

it("pages file metadata without bodies, handles a removed cursor row, and scopes cursors and access to their project", async () => {
  const owner = await user(), stranger = await user(), date = new Date("2026-10-24T00:00:00Z");
  const project = await fixture.db.creationProject.create({ data: { userId: owner.id, createKey: randomUUID(), name: "Files", kind: "poster" } });
  const other = await fixture.db.creationProject.create({ data: { userId: owner.id, createKey: randomUUID(), name: "Other", kind: "poster" } });
  const prefix = randomUUID(), ids = Array.from({ length: 55 }, (_, index) => `${prefix}-${String(index).padStart(2, "0")}`);
  await fixture.db.creationArtifact.createMany({ data: ids.map(id => ({ id, projectId: project.id, createKey: id, kind: "poster", name: id, updatedAt: date })) });
  await fixture.db.creationArtifact.create({ data: { projectId: project.id, createKey: randomUUID(), kind: "poster", name: "Deleted", deletedAt: date } });
  const first = await readProject(owner.id, project.id, fixture.db);
  expect(first.artifacts).toHaveLength(24);
  // The next page is determined by cursor values, not by looking up this row.
  await fixture.db.creationArtifact.delete({ where: { id: first.artifacts.at(-1).id } });
  const second = await listProjectFiles(owner.id, project.id, first.artifactsNextCursor, fixture.db);
  const third = await listProjectFiles(owner.id, project.id, second.nextCursor, fixture.db);
  expect(second.items).toHaveLength(24); expect(third.items).toHaveLength(7); expect(third.nextCursor).toBeNull();
  const rows = [...first.artifacts, ...second.items, ...third.items];
  expect(new Set(rows.map(row => row.id)).size).toBe(55);
  expect(rows.every(row => Object.keys(row).sort().join(",") === "currentRevision,id,kind,name,updatedAt")).toBe(true);
  await expect(listProjectFiles(stranger.id, project.id, null, fixture.db)).rejects.toThrow("CREATION_PROJECT_NOT_FOUND");
  await expect(listProjectFiles(owner.id, other.id, first.artifactsNextCursor, fixture.db)).rejects.toThrow("INVALID_CURSOR");
  await expect(listProjectFiles(owner.id, project.id, "broken", fixture.db)).rejects.toThrow("INVALID_CURSOR");
  await updateProject(owner.id, project.id, { remove: true }, fixture.db);
  await expect(listProjectFiles(owner.id, project.id, null, fixture.db)).rejects.toThrow("CREATION_PROJECT_NOT_FOUND");
});
