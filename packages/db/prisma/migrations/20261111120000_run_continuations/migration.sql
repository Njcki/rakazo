-- Additive: older releases never read or write these columns.
-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "continuationDigest" TEXT,
ADD COLUMN     "continuationIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "continuationOfRunId" TEXT,
ADD COLUMN     "continuationPercent" INTEGER,
ADD COLUMN     "continuationRepeats" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "continuationRootRunId" TEXT,
ADD COLUMN     "continuationTainted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "runs_continuationOfRunId_key" ON "runs"("continuationOfRunId");

-- CreateIndex
CREATE INDEX "runs_continuationRootRunId_idx" ON "runs"("continuationRootRunId");
