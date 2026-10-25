import { beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ config: vi.fn(), user: vi.fn(), project: vi.fn(), artifact: vi.fn(), session: vi.fn(), run: vi.fn(), import: vi.fn(), export: vi.fn(), auth: vi.fn(), read: vi.fn() }));
vi.mock("../../src/lib/prisma.js", () => ({ prisma: {
  systemConfig: { findUnique: ports.config }, user: { findUnique: ports.user },
  creationProject: { findFirst: ports.project }, creationArtifact: { findFirst: ports.artifact },
  creationSession: { findFirst: ports.session }, creationRun: { findFirst: ports.run },
  creationImport: { findFirst: ports.import }, artifactExport: { findFirst: ports.export },
} }));
vi.mock("../../src/lib/require-user.js", () => ({ requireUser: ports.auth }));
vi.mock("../../src/lib/domain/creation/projects", () => ({ readProject: ports.read, updateProject: vi.fn() }));
import { CREATION_ACCESS_FLAGS } from "../../src/lib/creation/access-flags.js";
import { getCreationAccessConfig, effectiveCreationEnv, getCreationEnv, assertCreationAccess, assertCreationResource, allowedCreationKinds } from "../../src/lib/creation/access.js";
import { requireCreationUser } from "../../src/lib/creation/require-user.js";
import { GET as readProject } from "../../src/app/api/creation/projects/[id]/route.js";

const flags = value => Object.fromEntries(CREATION_ACCESS_FLAGS.map(({ key }) => [key, value]));
const env = value => Object.fromEntries(CREATION_ACCESS_FLAGS.map(({ env: name }) => [name, String(value)]));
beforeEach(() => {
  Object.values(ports).forEach(port => port.mockReset());
  ports.config.mockResolvedValue({ value: JSON.stringify(flags(false)) });
  ports.user.mockResolvedValue({ role: "user", status: "active" });
  ports.auth.mockResolvedValue({ id: "u", role: "root" }); // Stale/forged session role is ignored.
  ports.project.mockResolvedValue({ kind: "poster" });
  ports.read.mockResolvedValue({ id: "p", kind: "poster" });
});

it.each(["user", "agent", "admin"])("closed switches deny %s while open switches allow access", role => {
  const user = { role, status: "active" };
  for (const { key } of CREATION_ACCESS_FLAGS) {
    const options = key === "runs" ? { runs: true, workspace: false } : { kind: key };
    expect(() => assertCreationAccess(effectiveCreationEnv(flags(false), user, {}), options)).toThrow("CREATION_NOT_ENABLED");
    expect(() => assertCreationAccess(effectiveCreationEnv(flags(true), user, {}), options)).not.toThrow();
  }
});

it("root bypasses all seven access switches but does not enable other infrastructure flags", () => {
  const resolved = effectiveCreationEnv(flags(false), { role: "root", status: "active" }, { CREATION_NATIVE_OFFICE_ENABLED: "false", CREATION_AGENT_ENABLED: "false" });
  for (const { env: name } of CREATION_ACCESS_FLAGS) expect(resolved[name]).toBe("true");
  expect(resolved.CREATION_NATIVE_OFFICE_ENABLED).toBe("false");
  expect(resolved.CREATION_AGENT_ENABLED).toBe("false");
  expect(() => effectiveCreationEnv(flags(true), { role: "root", status: "banned" })).toThrow("FORBIDDEN");
  expect(() => effectiveCreationEnv(flags(true), null)).toThrow("FORBIDDEN");
});

it("uses environment defaults until saved, then applies live DB settings over the environment", async () => {
  ports.config.mockResolvedValueOnce(null);
  expect(await getCreationAccessConfig(undefined, env(true))).toEqual(flags(true));
  expect(await getCreationAccessConfig(undefined, env(true))).toEqual(flags(false));
  ports.config.mockResolvedValue({ value: JSON.stringify({ ...flags(true), poster: false }) });
  expect((await getCreationEnv("u", { env: env(false) })).CREATION_SHEET_ENABLED).toBe("true");
  expect((await getCreationEnv("u", { env: env(true) })).CREATION_POSTER_ENABLED).toBe("false");
  ports.config.mockResolvedValue({ value: '{"poster":"false"}' });
  await expect(getCreationAccessConfig()).rejects.toThrow("CREATION_CONFIG_INVALID");
});

it("keeps workspace, individual modules and task admission independent", () => {
  const user = { role: "user", status: "active" };
  let resolved = effectiveCreationEnv({ ...flags(true), runs: false, web: false }, user, {});
  expect(() => assertCreationAccess(resolved, { kind: "poster" })).not.toThrow();
  expect(() => assertCreationAccess(resolved, { kind: "poster", runs: true })).toThrow();
  expect(allowedCreationKinds(resolved)).toEqual(["poster", "slides", "document", "sheet"]);
  resolved = effectiveCreationEnv({ ...flags(true), workspace: false }, user, {});
  expect(allowedCreationKinds(resolved)).toEqual([]);
  expect(() => assertCreationAccess(resolved, { kind: "image", runs: true })).not.toThrow();
});

it("enforces persisted roles on old project links before loading project contents", async () => {
  const context = { params: Promise.resolve({ id: "p" }) };
  expect((await readProject(new Request("https://example.test/api/creation/projects/p"), context)).status).toBe(403);
  expect(ports.read).not.toHaveBeenCalled();
  ports.user.mockResolvedValue({ role: "root", status: "active" });
  expect((await readProject(new Request("https://example.test/api/creation/projects/p"), context)).status).toBe(200);
  expect(ports.project).toHaveBeenCalledWith({ where: { id: "p", userId: "u" }, select: { kind: true } });
  ports.project.mockResolvedValue(null);
  expect((await readProject(new Request("https://example.test/api/creation/projects/foreign"), context)).status).toBe(404);
});

it.each(["artifact", "session", "run", "import", "export"])("guards the stored kind of an owned %s, including nested resources", async resource => {
  const project = { kind: "poster" }, artifact = { kind: "poster", project };
  ports[resource].mockResolvedValue(resource === "export" ? { revision: { artifact } } : { ...artifact });
  const resolved = effectiveCreationEnv({ ...flags(true), poster: false }, { role: "user", status: "active" }, {});
  await expect(assertCreationResource("u", resolved, resource, "item")).rejects.toThrow("CREATION_NOT_ENABLED");
  ports[resource].mockResolvedValue(null);
  await expect(assertCreationResource("u", env(true), resource, "foreign")).rejects.toThrow("CREATION_RESOURCE_NOT_FOUND");
});

it("blocks API admission immediately after an administrator closes a switch", async () => {
  ports.config.mockResolvedValue({ value: JSON.stringify(flags(true)) });
  await expect(requireCreationUser({ kind: "poster", runs: true })).resolves.toMatchObject({ id: "u" });
  ports.config.mockResolvedValue({ value: JSON.stringify({ ...flags(true), runs: false }) });
  await expect(requireCreationUser({ kind: "poster", runs: true })).rejects.toThrow("CREATION_NOT_ENABLED");
});
