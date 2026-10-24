ALTER TABLE "CreationStep"
ADD COLUMN "dependsOn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "CreationStep" AS step
SET "dependsOn" = ARRAY[previous."id"]
FROM "CreationStep" AS previous
WHERE step."runId" = previous."runId"
  AND step."position" = previous."position" + 1;
