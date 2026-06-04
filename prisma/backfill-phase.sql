-- One-time backfill: infer each existing project's workflow `phase` from its
-- current data (assets / DT answers / assessments / finalized). Only touches
-- rows still at the default 'INTAKE', so it is safe to re-run and never
-- clobbers a project that has already progressed under the new workflow.
--
-- Run with: npx prisma db execute --file prisma/backfill-phase.sql --schema prisma/schema.prisma
UPDATE "Project" SET
  "phase" = CASE
    WHEN "finalizedAt" IS NOT NULL THEN 'DONE'
    WHEN EXISTS (
      SELECT 1 FROM "DTAssessment" a
      WHERE a."projectId" = "Project"."id"
        AND (a."testMethod" <> '' OR a."testResult" <> '' OR a."verdict" IS NOT NULL)
    ) THEN 'ASSESSMENT'
    WHEN EXISTS (SELECT 1 FROM "DTAnswer" d WHERE d."projectId" = "Project"."id") THEN 'DT_CONSULTANT'
    WHEN EXISTS (SELECT 1 FROM "Asset" s WHERE s."projectId" = "Project"."id") THEN 'ASSETS_CONSULTANT'
    WHEN "screeningComplete" = 1 THEN 'ASSETS_CUSTOMER'
    ELSE 'INTAKE'
  END,
  "phaseUpdatedAt" = "updatedAt"
WHERE "phase" = 'INTAKE';
