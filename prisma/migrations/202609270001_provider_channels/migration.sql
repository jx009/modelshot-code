ALTER TABLE "ModelProvider" ADD COLUMN "kind" TEXT;
UPDATE "ModelProvider"
SET "kind" = CASE WHEN "name" IN ('openai', 'gemini', 'fashn') THEN "name" ELSE 'openai' END;
ALTER TABLE "ModelProvider" ALTER COLUMN "kind" SET NOT NULL;
ALTER TABLE "ModelProvider" ALTER COLUMN "kind" SET DEFAULT 'openai';
ALTER TABLE "ModelProvider" ADD COLUMN "isPlanner" BOOLEAN NOT NULL DEFAULT false;
