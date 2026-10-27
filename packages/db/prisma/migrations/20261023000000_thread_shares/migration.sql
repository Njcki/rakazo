-- CreateTable
CREATE TABLE "thread_shares" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "messageIds" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "thread_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thread_shares_token_key" ON "thread_shares"("token");

-- CreateIndex
CREATE INDEX "thread_shares_threadId_idx" ON "thread_shares"("threadId");

-- AddForeignKey
ALTER TABLE "thread_shares" ADD CONSTRAINT "thread_shares_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
