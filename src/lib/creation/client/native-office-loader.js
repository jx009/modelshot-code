// Static paths let Next split the runtimes. No global editor/CSS import belongs
// in the homepage, canvas, shared layout, or a barrel re-export.
const loaders = {
  document: () => import("./univer-docs-runtime.js"),
  sheet: () => import("./univer-sheets-runtime.js"),
};
const pending = new Map();
export async function loadNativeOfficeRuntime(kind, { signal } = {}) {
  signal?.throwIfAborted();
  if (typeof window === "undefined") throw new Error("NATIVE_OFFICE_BROWSER_REQUIRED");
  if (!Object.hasOwn(loaders, kind)) throw new Error("ARTIFACT_KIND_MISMATCH");
  let promise = pending.get(kind);
  if (!promise) {
    promise = loaders[kind]().catch(error => { if (pending.get(kind) === promise) pending.delete(kind); throw error; });
    pending.set(kind, promise);
  }
  const runtime = await promise;
  // A cancelled mount may share a successful import with another mount, but
  // it must never initialize an engine after the original file has closed.
  signal?.throwIfAborted();
  return runtime;
}
