import { getDisplayPlan, listPlansForBot } from "@rakazo/adapters";
import type { RouterContext } from "./context.js";
import {
  createThreadShare,
  listThreadShares,
  removeThreadShare,
  revokeThreadShare,
} from "../thread-shares.js";

/** Rakazo NK: plan sidebar + thread share RPC surface. */
export function plansSharesRoutes(ctx: RouterContext) {
  const { deps, authed, repos } = ctx;
  return {
    stats: {
      searches: authed.stats.searches.handler(async () => {
        const rows = await deps.prisma.searchStat.findMany({
          orderBy: [{ count: "desc" }, { service: "asc" }],
        });
        return rows.map((row) => ({ service: row.service, count: row.count }));
      }),
      resetSearches: authed.stats.resetSearches.handler(async () => {
        await deps.prisma.searchStat.deleteMany({});
        return { ok: true as const };
      }),
    },
    threadShares: {
      create: authed.threadShares.create.handler(async ({ context, input }) =>
        createThreadShare({ ...deps, webOrigin: deps.env.webOrigin }, context.actor, input),
      ),
      list: authed.threadShares.list.handler(async ({ context, input }) =>
        listThreadShares(deps, context.actor, input),
      ),
      revoke: authed.threadShares.revoke.handler(async ({ context, input }) =>
        revokeThreadShare(deps, context.actor, input),
      ),
      remove: authed.threadShares.remove.handler(async ({ context, input }) =>
        removeThreadShare(deps, context.actor, input),
      ),
    },
    plans: {
      active: authed.plans.active.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return getDisplayPlan(
          { prisma: deps.prisma },
          { spaceId: context.actor.spaceId, botId: input.botId },
        );
      }),
      list: authed.plans.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return listPlansForBot(
          { prisma: deps.prisma },
          {
            spaceId: context.actor.spaceId,
            botId: input.botId,
            includeClosed: input.includeClosed,
          },
        );
      }),
    },
  };
}
