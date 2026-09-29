CREATE TABLE "StudioDocumentView" (
  "documentId" TEXT PRIMARY KEY,
  "camera" JSONB NOT NULL,
  CONSTRAINT "StudioDocumentView_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudioDocument"("id") ON DELETE CASCADE
);
