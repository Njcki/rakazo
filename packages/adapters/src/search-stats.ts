import { getLogger } from "@rakazo/logging";
import type { PrismaClient } from "@rakazo/db";
import { createWebProvider } from "./web-provider-factory.js";

export async function recordSearchStat(prisma: PrismaClient, service: string): Promise<void> {
  try {
    await prisma.searchStat.upsert({
      where: { service },
      update: { count: { increment: 1 } },
      create: { service, count: 1 },
    });
  } catch (error) {
    // Stats are best-effort; a counter failure must not break the search.
    getLogger().warn("web_search stat record failed", {
      service,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Deployment web provider that records which tier answered.
 * The worker and the API must pass this: a plain `createWebProvider()` has no counter,
 * and it replaces the fallback below.
 */
export function createCountingWebProvider(prisma: PrismaClient) {
  return createWebProvider(undefined, undefined, process.env, (service) => {
    void recordSearchStat(prisma, service);
  });
}
