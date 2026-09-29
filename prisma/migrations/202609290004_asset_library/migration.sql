CREATE TABLE "LibraryCategory" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LibraryCategory_userId_name_key" ON "LibraryCategory"("userId", name);
CREATE TABLE "LibraryItem" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "assetId" TEXT NOT NULL REFERENCES "Asset"(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  "categoryId" TEXT REFERENCES "LibraryCategory"(id) ON DELETE SET NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LibraryItem_userId_assetId_key" ON "LibraryItem"("userId", "assetId");
CREATE INDEX "LibraryItem_userId_deletedAt_categoryId_createdAt_id_idx" ON "LibraryItem"("userId", "deletedAt", "categoryId", "createdAt", id);
