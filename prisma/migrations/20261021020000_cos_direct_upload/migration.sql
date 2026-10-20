CREATE TABLE "AssetUpload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetUpload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AssetUpload_expiresAt_idx" ON "AssetUpload"("expiresAt");
CREATE INDEX "AssetUpload_userId_createdAt_idx" ON "AssetUpload"("userId", "createdAt");
