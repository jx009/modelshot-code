ALTER TABLE "ModelProvider" ADD COLUMN "creditCost" INTEGER NOT NULL DEFAULT 18;

CREATE TABLE "StudioToolConfig" (
    "toolId" TEXT NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioToolConfig_pkey" PRIMARY KEY ("toolId")
);

INSERT INTO "StudioToolConfig" ("toolId", "creditCost", "isEnabled") VALUES
  ('expand', 18, true),
  ('upscale', 4, true),
  ('describe', 1, true),
  ('erase', 18, true),
  ('inpaint', 18, true),
  ('split', 20, true),
  ('move', 18, true),
  ('ocr', 1, true),
  ('remove-bg', 2, true),
  ('crop', 0, true),
  ('video', 60, true)
ON CONFLICT ("toolId") DO NOTHING;
