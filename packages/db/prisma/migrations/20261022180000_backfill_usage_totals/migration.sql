-- Rows written before the total was derived from measured input and output.
-- Unreported cache is zero, matching normalizePiUsage. Calls with no token
-- measurement stay null.
UPDATE "usage_records"
SET "totalTokens" =
  "inputTokens" + "outputTokens"
  + COALESCE("cacheReadTokens", 0)
  + COALESCE("cacheWriteTokens", 0)
WHERE "totalTokens" IS NULL
  AND "inputTokens" IS NOT NULL
  AND "outputTokens" IS NOT NULL;
