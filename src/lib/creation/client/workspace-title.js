let current = null;
const listeners = new Set();
export const subscribeWorkspaceTitle = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const workspaceTitleSnapshot = () => current?.title || "";
export const workspaceTitleServerSnapshot = () => "";
export function publishWorkspaceTitle(projectId, title) {
  const value = { projectId, title }; current = value; for (const listener of listeners) listener();
  return () => { if (current === value) { current = null; for (const listener of listeners) listener(); } };
}
