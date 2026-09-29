let database;
export function activeProject(userId) {
  try { return JSON.parse(localStorage.getItem(`modelshot-active-project:${userId}`)); }
  catch { return null; }
}
export function rememberProject(userId, draft) {
  try { localStorage.setItem(`modelshot-active-project:${userId}`, JSON.stringify({ id: draft.id, createKey: draft.createKey })); }
  catch { /* The full draft still persists in IndexedDB. */ }
}
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("modelshot-projects", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
export async function readProjectDraft(userId, key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get(`${userId}:${key}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function writeProjectDraft(userId, key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put(value, `${userId}:${key}`);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("LOCAL_SAVE_FAILED"));
  });
}
