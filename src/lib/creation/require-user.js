import { requireUser } from "../require-user.js";
import { assertCreationAccess, assertCreationResource, getCreationEnv } from "./access.js";

export async function requireCreationUser({ resource, id, kind, workspace = true, runs = false } = {}) {
  const user = await requireUser();
  const creationEnv = await getCreationEnv(user.id);
  // Runs may belong to the existing image canvas, which has no creation workspace.
  assertCreationAccess(creationEnv, { kind, workspace: resource === "run" ? false : workspace, runs });
  if (resource) await assertCreationResource(user.id, creationEnv, resource, id);
  return { ...user, creationEnv };
}
