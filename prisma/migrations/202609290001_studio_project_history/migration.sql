ALTER TABLE "StudioDocument"
  ADD COLUMN "nameSource" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "createKey" TEXT,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'canvas',
  ADD COLUMN "coverAssetId" TEXT,
  ADD COLUMN "itemCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "StudioDocument" d SET
  "kind" = CASE WHEN d.content ? 'commerce' THEN 'commerce' ELSE 'canvas' END,
  "coverAssetId" = COALESCE(d.content #>> '{commerce,productAssetId}',
    (SELECT layer->>'assetId' FROM jsonb_array_elements(COALESCE(d.content->'layers','[]'::jsonb)) layer WHERE layer->>'type' = 'image' LIMIT 1)),
  "itemCount" = jsonb_array_length(COALESCE(d.content #> '{commerce,sections}', d.content->'layers', '[]'::jsonb));

UPDATE "StudioDocument" d SET
  name = COALESCE(NULLIF(LEFT(regexp_replace(trim((SELECT message->>'text'
    FROM jsonb_array_elements(COALESCE(d.content->'messages','[]'::jsonb)) message
    WHERE message->>'role' = 'user' AND trim(message->>'text') <> '' LIMIT 1)), '\s+', ' ', 'g'), 40), ''),
    '未命名项目 · ' || to_char(d."createdAt", 'YYYY-MM-DD')),
  "nameSource" = 'fallback'
  WHERE trim(d.name) IN ('', 'Untitled', '未命名项目');

CREATE UNIQUE INDEX "StudioDocument_userId_createKey_key" ON "StudioDocument"("userId", "createKey");
CREATE INDEX "StudioDocument_userId_deletedAt_updatedAt_id_idx" ON "StudioDocument"("userId", "deletedAt", "updatedAt", "id");
