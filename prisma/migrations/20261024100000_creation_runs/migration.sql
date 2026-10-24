-- Additive only: no existing canvas content or generation records are rewritten.
CREATE TABLE "CreationRun" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "documentId" TEXT,
  "requestId" TEXT NOT NULL, "digest" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "input" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "maxCredits" INTEGER NOT NULL, "committedCredits" INTEGER NOT NULL DEFAULT 0,
  "eventSequence" INTEGER NOT NULL DEFAULT 0, "errorCode" TEXT,
  "cancelRequestedAt" TIMESTAMP(3), "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreationRun_credit_bounds" CHECK ("maxCredits" >= 0 AND "committedCredits" >= 0 AND "committedCredits" <= "maxCredits"),
  CONSTRAINT "CreationRun_sequence_bounds" CHECK ("eventSequence" >= 0)
);
CREATE TABLE "CreationStep" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "tool" TEXT NOT NULL, "params" JSONB NOT NULL, "explanation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'blocked', "expectedCost" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0, "jobId" TEXT, "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreationStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreationStep_bounds" CHECK ("position" >= 0 AND "position" < 64 AND "attempt" >= 0 AND "expectedCost" >= 0)
);
CREATE TABLE "CreationStepAttempt" (
  "id" TEXT NOT NULL, "stepId" TEXT NOT NULL, "number" INTEGER NOT NULL,
  "jobId" TEXT NOT NULL, "cost" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreationStepAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreationStepAttempt_bounds" CHECK ("number" >= 0 AND "cost" >= 0)
);
CREATE TABLE "CreationEvent" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreationEvent_sequence_bounds" CHECK ("sequence" > 0)
);
CREATE UNIQUE INDEX "CreationRun_requestId_key" ON "CreationRun"("requestId");
CREATE INDEX "CreationRun_userId_createdAt_id_idx" ON "CreationRun"("userId", "createdAt", "id");
CREATE INDEX "CreationRun_userId_status_idx" ON "CreationRun"("userId", "status");
CREATE INDEX "CreationRun_documentId_createdAt_idx" ON "CreationRun"("documentId", "createdAt");
CREATE INDEX "CreationRun_status_nextCheckAt_idx" ON "CreationRun"("status", "nextCheckAt");
CREATE UNIQUE INDEX "CreationStep_jobId_key" ON "CreationStep"("jobId");
CREATE UNIQUE INDEX "CreationStep_runId_position_key" ON "CreationStep"("runId", "position");
CREATE UNIQUE INDEX "CreationStepAttempt_jobId_key" ON "CreationStepAttempt"("jobId");
CREATE UNIQUE INDEX "CreationStepAttempt_stepId_number_key" ON "CreationStepAttempt"("stepId", "number");
CREATE UNIQUE INDEX "CreationEvent_runId_sequence_key" ON "CreationEvent"("runId", "sequence");
CREATE INDEX "CreationEvent_createdAt_idx" ON "CreationEvent"("createdAt");
ALTER TABLE "CreationRun" ADD CONSTRAINT "CreationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreationRun" ADD CONSTRAINT "CreationRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StudioDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreationStep" ADD CONSTRAINT "CreationStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CreationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreationStepAttempt" ADD CONSTRAINT "CreationStepAttempt_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "CreationStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreationEvent" ADD CONSTRAINT "CreationEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CreationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
