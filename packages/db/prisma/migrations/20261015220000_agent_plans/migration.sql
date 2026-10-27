-- Task decomposition plans (ordered steps with status) for bots.

CREATE TABLE "agent_plans" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_plan_steps" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "notes" TEXT NOT NULL DEFAULT '',
    "blockedBy" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_plan_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_plans_spaceId_botId_status_idx" ON "agent_plans"("spaceId", "botId", "status");
CREATE INDEX "agent_plans_spaceId_botId_updatedAt_idx" ON "agent_plans"("spaceId", "botId", "updatedAt");
CREATE UNIQUE INDEX "agent_plan_steps_planId_index_key" ON "agent_plan_steps"("planId", "index");
CREATE INDEX "agent_plan_steps_planId_status_idx" ON "agent_plan_steps"("planId", "status");

ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_plans" ADD CONSTRAINT "agent_plans_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_plan_steps" ADD CONSTRAINT "agent_plan_steps_planId_fkey" FOREIGN KEY ("planId") REFERENCES "agent_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
