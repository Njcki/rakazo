-- Global counters of web searches by the service that answered (patch 0032).
CREATE TABLE "search_stats" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "search_stats_service_key" ON "search_stats"("service");
