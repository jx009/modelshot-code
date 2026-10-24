let sessionId;
const opened = new Map();
// Do not use sessionStorage: duplicating a tab may copy its contents. Each JS
// realm receives a fresh identity; reload recovery is an explicit local choice.
export function creationDraftSession() {
  sessionId ||= globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return sessionId;
}
export function newDraftBranch() { return globalThis.crypto?.randomUUID?.() || `branch-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
const keyFor = (userId, artifactId) => JSON.stringify([userId, artifactId]);
export function hasOpenedDraftSession(userId, artifactId) { return opened.has(keyFor(userId, artifactId)); }
export function rememberedDraftSession(userId, artifactId) { return opened.get(keyFor(userId, artifactId)) || null; }
export function rememberDraftSession(userId, artifactId, selectedSessionId = creationDraftSession()) {
  const key = keyFor(userId, artifactId); opened.delete(key); opened.set(key, selectedSessionId);
  while (opened.size > 32) opened.delete(opened.keys().next().value);
}
