-- 分镜成片平台曲库：管理员上传的背景音乐。音频文件本身是一条普通 Asset。
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mood" TEXT NOT NULL DEFAULT '',
    "duration" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MusicTrack_assetId_key" ON "MusicTrack"("assetId");
CREATE INDEX "MusicTrack_deletedAt_isActive_sortOrder_idx" ON "MusicTrack"("deletedAt", "isActive", "sortOrder");

ALTER TABLE "MusicTrack" ADD CONSTRAINT "MusicTrack_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
