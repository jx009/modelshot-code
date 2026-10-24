import { expect, it, vi } from "vitest";
import { listProjectFiles, projectFilePage } from "../../src/lib/domain/creation/project-files.js";

vi.mock("../../src/lib/prisma.js", () => ({ prisma: {} }));
const rows = Array.from({ length: 25 }, (_, index) => ({ id: `file-${25 - index}`, name: "Report", kind: "document", currentRevision: 2, updatedAt: new Date("2026-10-24T00:00:00Z") }));
function database(owned = true) {
  return { creationProject: { findFirst: vi.fn(async () => owned ? { id: "p" } : null) }, creationArtifact: { findMany: vi.fn(async () => rows) } };
}

it("searches only owned live project metadata with one bounded page, without a count or body read", async () => {
  const db = database(), page = await listProjectFiles("u", "p", { q: " Report " }, db);
  expect(page.items).toHaveLength(24);
  expect(db.creationProject.findFirst).toHaveBeenCalledWith({ where: { id: "p", userId: "u", deletedAt: null }, select: { id: true } });
  expect(db.creationArtifact.findMany).toHaveBeenCalledExactlyOnceWith({
    where: { projectId: "p", deletedAt: null, project: { userId: "u", deletedAt: null }, name: { contains: "Report", mode: "insensitive" } },
    select: { id: true, name: true, kind: true, currentRevision: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 25,
  });
  await listProjectFiles("u", "p", { q: "Report", cursor: page.nextCursor }, db);
  expect(db.creationArtifact.findMany.mock.calls[1][0].where.OR).toEqual([
    { updatedAt: { lt: rows[23].updatedAt } }, { updatedAt: rows[23].updatedAt, id: { lt: rows[23].id } },
  ]);
});

it("binds cursors to the normalized search and project, while accepting old unfiltered cursors", async () => {
  const db = database(), cursor = projectFilePage("p", rows, "Report").nextCursor;
  for (const [projectId, options] of [["p", { q: "Other", cursor }], ["p", cursor], ["other", { q: "Report", cursor }]]) {
    await expect(listProjectFiles("u", projectId, options, db)).rejects.toThrow("INVALID_CURSOR");
  }
  expect(db.creationArtifact.findMany).not.toHaveBeenCalled();
  const oldCursor = Buffer.from(JSON.stringify({ version: 1, projectId: "p", id: rows[23].id, date: rows[23].updatedAt })).toString("base64url");
  expect((await listProjectFiles("u", "p", oldCursor, db)).items).toHaveLength(24);
  await expect(listProjectFiles("u", "p", { q: "Report", cursor: oldCursor }, db)).rejects.toThrow("INVALID_CURSOR");
});

it("refuses unowned projects and oversized search before listing any files", async () => {
  const db = database(false);
  await expect(listProjectFiles("other", "p", { q: "Report" }, db)).rejects.toThrow("CREATION_PROJECT_NOT_FOUND");
  for (const q of ["x".repeat(101), 123, null]) await expect(listProjectFiles("u", "p", { q }, db)).rejects.toThrow("INVALID_PAYLOAD");
  expect(db.creationArtifact.findMany).not.toHaveBeenCalled();
});

it("treats SQL pattern characters as literal filename characters", async () => {
  const db = database();
  await listProjectFiles("u", "p", { q: "100%_\\report" }, db);
  expect(db.creationArtifact.findMany.mock.calls[0][0].where.name.contains).toBe("100\\%\\_\\\\report");
});
