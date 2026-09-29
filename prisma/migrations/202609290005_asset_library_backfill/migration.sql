INSERT INTO "LibraryItem" (id, "userId", "assetId", name, "createdAt")
  SELECT 'lib_' || md5(id), "userId", id, '上传素材 · ' || to_char("createdAt", 'YYYY-MM-DD'), "createdAt"
  FROM "Asset" WHERE kind = 'upload' AND status = 'active';
INSERT INTO "AssetReference" (id, "assetId", "entityId", kind)
  SELECT 'libref_' || md5(id), "assetId", id, 'library' FROM "LibraryItem" ON CONFLICT DO NOTHING;
