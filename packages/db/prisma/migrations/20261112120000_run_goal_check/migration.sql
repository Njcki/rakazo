-- Additive: older releases never read or write this column.
-- The completion check of a long request (set_goal_check), kept on the chain's root run.
-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "continuationGoal" JSONB;
