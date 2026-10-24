let opening;
// Register writes immediately, before opening IndexedDB. A remounted editor's
// read must follow the old instance's pending unmount write for the same file.
const pending = new Map();
function serialize(key, task) {
  const operation = (pending.get(key) || Promise.resolve()).catch(() => {}).then(task);
  pending.set(key, operation);
  const release = () => { if (pending.get(key) === operation) pending.delete(key); };
  operation.then(release, release);
  return operation;
}
const MAX_DRAFT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_DRAFTS = 10;
function open() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open("modelshot-creation-drafts", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("documents");
      request.result.createObjectStore("metadata", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}
function descriptor(userId, artifactId, sessionId, part = "content") {
  if (sessionId !== undefined && (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId))) throw new Error("LOCAL_DRAFT_SESSION_INVALID");
  const groupKey = sessionId === undefined ? `${userId}:${artifactId}` : JSON.stringify(["session", userId, artifactId, sessionId]);
  const key = sessionId === undefined ? `${part === "text" ? "text:" : ""}${userId}:${artifactId}` : JSON.stringify(["session", userId, artifactId, sessionId, part]);
  return { key, groupKey, ...(sessionId === undefined ? {} : { userId, artifactId, sessionId, part }) };
}
export function readArtifactDraft(userId, artifactId, sessionId) {
  const { key } = descriptor(userId, artifactId, sessionId);
  return serialize(key, () => readDraft(key));
}
async function readDraft(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("documents").objectStore("documents").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function writeArtifactDraft(userId, artifactId, draft, sessionId) {
  const entry = descriptor(userId, artifactId, sessionId);
  return serialize(entry.key, () => writeDraft(entry, draft));
}
export function readArtifactTextDraft(userId, artifactId, sessionId) {
  const { key } = descriptor(userId, artifactId, sessionId, "text");
  return serialize(key, async () => (await readDraft(key))?.textDraft ?? null);
}
export function writeArtifactTextDraft(userId, artifactId, textDraft, prepare, sessionId) {
  const entry = descriptor(userId, artifactId, sessionId, "text");
  // Reserve ordering synchronously. A new editor's read must wait even when
  // clearing this record still depends on the old editor's operation write.
  return serialize(entry.key, async () => { await prepare?.(); return writeDraft(entry, { textDraft, dirty: Boolean(textDraft) }); });
}
function recordFor(entry, draft, previous) {
  const bytes = new Blob([JSON.stringify(draft)]).size;
  if (bytes > MAX_DRAFT_BYTES) throw new Error("LOCAL_DRAFT_TOO_LARGE");
  return { ...entry, bytes, dirty: Boolean(draft.dirty || draft.inflight || draft.operations?.length || draft.copyRequest || draft.restoreRequest), updatedAt: Date.now(), revision: (previous?.revision || 0) + 1 };
}
function quotaEvictions(records, incoming, protectedKeys = new Set()) {
  const replacing = new Set(incoming.map(row => row.key));
  const kept = new Map(records.filter(row => !replacing.has(row.key)).map(row => [row.key, row]));
  let total = incoming.reduce((sum, row) => sum + row.bytes, 0) + [...kept.values()].reduce((sum, row) => sum + row.bytes, 0);
  const count = () => new Set([...incoming, ...kept.values()].map(row => row.groupKey || row.key)).size;
  const removals = [];
  for (const record of [...kept.values()].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (total <= MAX_TOTAL_BYTES && count() <= MAX_DRAFTS) break;
    if (record.dirty || protectedKeys.has(record.key)) continue;
    removals.push(record.key); total -= record.bytes; kept.delete(record.key);
  }
  if (total > MAX_TOTAL_BYTES || count() > MAX_DRAFTS) throw new Error("LOCAL_DRAFT_CAPACITY");
  return removals;
}
async function writeDraft(entry, draft) {
  const initial = recordFor(entry, draft);
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "metadata"], "readwrite"), documents = tx.objectStore("documents"), meta = tx.objectStore("metadata");
    let failure;
    const query = meta.getAll();
    query.onsuccess = () => {
      try {
        const record = { ...initial, revision: (query.result.find(row => row.key === entry.key)?.revision || 0) + 1 };
        for (const key of quotaEvictions(query.result, [record])) { documents.delete(key); meta.delete(key); }
        documents.put(draft, entry.key); meta.put(record);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("LOCAL_SAVE_FAILED"));
    tx.onabort = () => reject(failure || tx.error || new Error("LOCAL_SAVE_FAILED"));
  });
}

function sessionRecords(records, userId, artifactId, sessionId) {
  const keys = [descriptor(userId, artifactId, sessionId === "legacy" ? undefined : sessionId).key, descriptor(userId, artifactId, sessionId === "legacy" ? undefined : sessionId, "text").key];
  return records.filter(row => keys.includes(row.key));
}
function versionOf(records) { return JSON.stringify(records.map(row => [row.key, row.revision || 0, row.updatedAt, row.bytes]).sort((a, b) => a[0].localeCompare(b[0]))); }
export async function listArtifactDraftSessions(userId, artifactId, currentSessionId) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("metadata").objectStore("metadata").getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const records = request.result;
      const ids = new Set(["legacy", ...records.filter(row => row.userId === userId && row.artifactId === artifactId).map(row => row.sessionId)]);
      const sessions = [...ids].filter(Boolean).map(sessionId => {
        const rows = sessionRecords(records, userId, artifactId, sessionId);
        return { sessionId, token: versionOf(rows), updatedAt: rows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0), dirty: rows.some(row => row.dirty), hasText: rows.some(row => row.dirty && (row.part === "text" || row.key === `text:${userId}:${artifactId}`)) };
      });
      resolve({ own: sessionRecords(records, userId, artifactId, currentSessionId).length > 0, items: sessions.filter(row => row.sessionId !== currentSessionId && row.dirty).sort((a, b) => b.updatedAt - a.updatedAt) });
    };
  });
}

// Explicit recovery copies a consistent pair into the new browser session;
// another tab's live records remain untouched. The server still arbitrates CAS.
export async function copyArtifactDraftSession(userId, artifactId, source, destinationSessionId) {
  if (source.sessionId === destinationSessionId) throw new Error("LOCAL_DRAFT_SESSION_INVALID");
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "metadata"], "readwrite"), documents = tx.objectStore("documents"), meta = tx.objectStore("metadata");
    let failure;
    const abort = error => { failure = error; tx.abort(); };
    const query = meta.getAll();
    query.onsuccess = () => {
      try {
        const rows = sessionRecords(query.result, userId, artifactId, source.sessionId);
        if (!rows.some(row => row.dirty) || versionOf(rows) !== source.token) throw new Error("LOCAL_DRAFT_CHANGED");
        const destination = sessionRecords(query.result, userId, artifactId, destinationSessionId);
        if (destination.some(row => row.dirty)) throw new Error("LOCAL_DRAFT_DESTINATION_DIRTY");
        const snapshots = []; let remaining = rows.length;
        for (const row of rows) {
          const reading = documents.get(row.key);
          reading.onsuccess = () => {
            try {
              if (!reading.result) throw new Error("LOCAL_DRAFT_CHANGED");
              const part = row.part === "text" || row.key === `text:${userId}:${artifactId}` ? "text" : "content";
              const entry = descriptor(userId, artifactId, destinationSessionId, part);
              snapshots.push({ draft: reading.result, record: recordFor(entry, reading.result, destination.find(item => item.key === entry.key)) });
              if (--remaining) return;
              const incomingKeys = new Set(snapshots.map(item => item.record.key));
              const leftover = destination.filter(row => !incomingKeys.has(row.key));
              const records = query.result.filter(row => !leftover.some(item => item.key === row.key));
              const evictions = quotaEvictions(records, snapshots.map(item => item.record), new Set(rows.map(row => row.key)));
              for (const key of [...evictions, ...leftover.map(row => row.key)]) { documents.delete(key); meta.delete(key); }
              for (const item of snapshots) { documents.put(item.draft, item.record.key); meta.put(item.record); }
            } catch (error) { abort(error); }
          };
        }
      } catch (error) { abort(error); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("LOCAL_SAVE_FAILED"));
    tx.onabort = () => reject(failure || tx.error || new Error("LOCAL_SAVE_FAILED"));
  });
}
export async function removeArtifactDraftSession(userId, artifactId, source) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "metadata"], "readwrite"), documents = tx.objectStore("documents"), meta = tx.objectStore("metadata");
    let failure;
    const query = meta.getAll();
    query.onsuccess = () => {
      try {
        const rows = sessionRecords(query.result, userId, artifactId, source.sessionId);
        if (!rows.length || versionOf(rows) !== source.token) throw new Error("LOCAL_DRAFT_CHANGED");
        for (const row of rows) { documents.delete(row.key); meta.delete(row.key); }
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("LOCAL_SAVE_FAILED"));
    tx.onabort = () => reject(failure || tx.error || new Error("LOCAL_SAVE_FAILED"));
  });
}
