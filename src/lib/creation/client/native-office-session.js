import { api, requestKey } from "../../client-api.js";
import { readArtifactDraft, writeArtifactDraft, readArtifactTextDraft, writeArtifactTextDraft } from "./drafts.js";
import { createNativeOfficeJournal } from "./native-office-journal.js";
import { invalidateProjectLists } from "../../studio/project-list.js";

// A session is scoped to one authenticated user, artifact and browser draft
// branch. The engine never receives API credentials or a second storage path.
export function createNativeOfficeSession({ userId, artifactId, draftSessionId, signal, onState }) {
  if (!userId || !artifactId || !/^[a-zA-Z0-9_-]{16,128}$/.test(draftSessionId || "")) throw new Error("LOCAL_DRAFT_SESSION_INVALID");
  const controller = new AbortController();
  const lifetime = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  const path = `/api/creation/artifacts/${encodeURIComponent(artifactId)}/native`;
  const journal = createNativeOfficeJournal({ artifactId, signal: lifetime, onState, requestKey,
    readDraft: () => readArtifactDraft(userId, artifactId, draftSessionId),
    writeDraft: draft => writeArtifactDraft(userId, artifactId, draft, draftSessionId),
    load: () => api(path, { signal: lifetime }),
    save: async body => {
      const result = await api(path, { method: "PUT", body, signal: lifetime, timeoutMs: 30000 });
      if (!lifetime.aborted) invalidateProjectLists(userId);
      return result;
    },
    copy: async body => {
      const result = await api(`${path}/copy`, { method: "POST", body, signal: lifetime, timeoutMs: 30000 });
      if (!lifetime.aborted) invalidateProjectLists(userId);
      return result;
    },
  });
  return { ...journal,
    readInputDraft: () => readArtifactTextDraft(userId, artifactId, draftSessionId),
    writeInputDraft: (draft, prepare) => writeArtifactTextDraft(userId, artifactId, draft, prepare, draftSessionId),
    dispose() { journal.dispose(); controller.abort(); } };
}
