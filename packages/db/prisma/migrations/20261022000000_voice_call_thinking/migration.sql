-- Per-user default reasoning level for voice calls (patch 0031).
ALTER TABLE "user" ADD COLUMN "voiceCallThinkingLevel" TEXT;

-- Per-bot override of the voice-call reasoning level (patch 0031).
ALTER TABLE "Bot" ADD COLUMN "voiceThinkingLevel" TEXT;
