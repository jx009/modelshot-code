CREATE TABLE "AssetDelivery" (
    "assetId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "variant" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "readyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetDelivery_pkey" PRIMARY KEY ("assetId", "targetId", "variant"),
    CONSTRAINT "AssetDelivery_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetDelivery_variant_check" CHECK ("variant" IN (0, 320, 640, 1280))
);
CREATE INDEX "AssetDelivery_targetId_readyAt_idx" ON "AssetDelivery"("targetId", "readyAt");
