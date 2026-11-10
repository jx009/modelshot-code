// The origin is written by admission from the owned video document, never from
// arbitrary POST /jobs fields. Keep this predicate inside the user's scope.
export function jobDocumentFilter(documentId) {
  return { OR: [
    { snapshot: { path: ["documentId"], equals: documentId } },
    { snapshot: { path: ["canvasOrigin", "documentId"], equals: documentId } },
  ] };
}

export function jobBelongsToDocument(job, documentId) {
  return Boolean(documentId && (job.documentId === documentId || job.canvasOrigin?.documentId === documentId));
}
