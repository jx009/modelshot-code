export const readStudioDraft = page => page.evaluate(async () => {
  const url = new URL(location.href), key = url.searchParams.get("document") || url.searchParams.get("draft");
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("modelshot-projects", 1);
    open.onsuccess = () => {
      if (!open.result.objectStoreNames.contains("drafts")) { open.result.close(); resolve(null); return; }
      const request = open.result.transaction("drafts").objectStore("drafts").getAll();
      request.onsuccess = () => { resolve(request.result.find(draft => (draft.id || draft.createKey) === key) || null); open.result.close(); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  });
});
