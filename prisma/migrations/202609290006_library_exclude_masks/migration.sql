-- Legacy brush masks used the upload endpoint. Keep them in their owning jobs,
-- but do not turn them into reusable user library items during the backfill.
DELETE FROM "AssetReference" AS ref USING "LibraryItem" AS item
WHERE ref.kind = 'library' AND ref."entityId" = item.id
  AND item.id = 'lib_' || md5(item."assetId")
  AND EXISTS (SELECT 1 FROM "TryOn" AS job WHERE job.snapshot->>'maskId' = item."assetId" AND job."userId" = item."userId");
DELETE FROM "LibraryItem" AS item
WHERE item.id = 'lib_' || md5(item."assetId")
  AND EXISTS (SELECT 1 FROM "TryOn" AS job WHERE job.snapshot->>'maskId' = item."assetId" AND job."userId" = item."userId");
