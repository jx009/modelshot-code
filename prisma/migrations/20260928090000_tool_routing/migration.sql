ALTER TABLE "StudioToolConfig" ADD COLUMN "routing" JSONB;

-- Separate an existing planner from its image channel, retaining encrypted keys.
INSERT INTO "ModelProvider" ("id", "name", "kind", "displayName", "creditCost", "isActive", "isDefault", "isPlanner", "priority", "costPerImage", "config", "createdAt", "updatedAt")
SELECT 'llm-' || "id", 'llm-' || "name", "kind", "displayName" || ' · 后台大语言模型', 1, "isActive", false, true, "priority", 0,
  (("config"::jsonb - 'imageMode' - 'studioDefault') || jsonb_build_object('scope', 'language', 'studioCapability', 'language', 'model', "config"::jsonb->>'chatModel'))::text,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ModelProvider"
WHERE "isPlanner" = true AND COALESCE("config"::jsonb->>'chatModel', '') <> '' AND COALESCE("config"::jsonb->>'scope', '') <> 'language';
UPDATE "ModelProvider" SET "isPlanner" = false
WHERE "isPlanner" = true AND COALESCE("config"::jsonb->>'scope', '') <> 'language';
