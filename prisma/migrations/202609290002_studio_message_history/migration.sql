CREATE TABLE "StudioMessage" (
  "documentId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "sequence" SERIAL NOT NULL,
  "role" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "assetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioMessage_pkey" PRIMARY KEY ("documentId", "messageId"),
  CONSTRAINT "StudioMessage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudioDocument"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "StudioMessage_sequence_key" ON "StudioMessage"("sequence");
CREATE INDEX "StudioMessage_documentId_sequence_idx" ON "StudioMessage"("documentId", "sequence");
CREATE TABLE "StudioAppliedResult" (
  "documentId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  CONSTRAINT "StudioAppliedResult_pkey" PRIMARY KEY ("documentId", "jobId"),
  CONSTRAINT "StudioAppliedResult_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudioDocument"("id") ON DELETE CASCADE
);
INSERT INTO "StudioMessage" ("documentId", "messageId", role, text, "assetId", "createdAt")
  SELECT d.id, m->>'id', m->>'role', m->>'text', m->>'assetId', d."createdAt"
  FROM "StudioDocument" d, jsonb_array_elements(COALESCE(d.content->'messages','[]'::jsonb)) m
  ON CONFLICT DO NOTHING;
INSERT INTO "StudioAppliedResult" ("documentId", "jobId")
  SELECT d.id, j FROM "StudioDocument" d, jsonb_array_elements_text(COALESCE(d.content->'appliedJobs','[]'::jsonb)) j
  ON CONFLICT DO NOTHING;
