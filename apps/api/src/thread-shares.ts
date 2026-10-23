import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { AdapterContext, ArtifactStore } from "@rakazo/adapter-kit";
import type {
  Actor,
  MessageBlock,
  SharedMessage,
  ThreadSharePublic,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

const DAY_MS = 86_400_000;

type ShareDeps = { prisma: PrismaClient };
type PublicShareDeps = { prisma: PrismaClient; artifacts: ArtifactStore };

/** The only block kinds that leave the instance in a public share. */
function sanitizeBlocks(blocks: MessageBlock[]): SharedMessage["blocks"] {
  const out: SharedMessage["blocks"] = [];
  for (const block of blocks) {
    if (block.kind === "text" && block.text.trim()) {
      out.push({ kind: "text", text: block.text });
    } else if (block.kind === "image") {
      out.push({
        kind: "image",
        artifactId: block.artifactId,
        mimeType: block.mimeType,
        name: block.name,
      });
    }
  }
  return out;
}

/** The owner's 1:1 thread for a bot, or null when the bot is not theirs. */
async function ownedBotThread(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
): Promise<{ threadId: string; botName: string } | null> {
  const bot = await prisma.bot.findFirst({
    where: { id: botId, spaceId: actor.spaceId, userId: actor.userId },
    select: { name: true, thread: { select: { id: true } } },
  });
  if (!bot?.thread) return null;
  return { threadId: bot.thread.id, botName: bot.name };
}

function toShareDto(row: {
  id: string;
  token: string;
  threadId: string;
  title: string | null;
  messageIds: unknown;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  viewCount: number;
}) {
  return {
    id: row.id,
    token: row.token,
    threadId: row.threadId,
    title: row.title,
    messageCount: Array.isArray(row.messageIds) ? row.messageIds.length : 0,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    viewCount: row.viewCount,
  };
}

export async function createThreadShare(
  deps: ShareDeps & { webOrigin: string },
  actor: Actor,
  input: { botId: string; messageIds: string[]; title?: string; expiresInDays?: number },
): Promise<{ token: string; url: string }> {
  const target = await ownedBotThread(deps.prisma, actor, input.botId);
  if (!target) throw new ORPCError("NOT_FOUND");
  const rows = await deps.prisma.message.findMany({
    where: { threadId: target.threadId, id: { in: input.messageIds } },
    orderBy: { seq: "asc" },
  });
  const snapshot = rows
    .map((row) => ({
      role: row.role,
      authorName: row.role === "user" ? "You" : target.botName,
      blocks: sanitizeBlocks(row.blocks as MessageBlock[]),
      createdAt: row.createdAt.toISOString(),
    }))
    .filter((message) => message.blocks.length > 0);
  if (snapshot.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "The selected messages have no shareable content." });
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * DAY_MS)
    : null;
  await deps.prisma.threadShare.create({
    data: {
      token,
      threadId: target.threadId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      title: input.title ?? null,
      messageIds: rows.map((row) => row.id),
      snapshot,
      expiresAt,
    },
  });
  const url = new URL(`/share/${token}`, deps.webOrigin).href;
  return { token, url };
}

export async function listThreadShares(
  deps: ShareDeps,
  actor: Actor,
  input: { botId: string },
) {
  const target = await ownedBotThread(deps.prisma, actor, input.botId);
  if (!target) throw new ORPCError("NOT_FOUND");
  const now = new Date();
  const rows = await deps.prisma.threadShare.findMany({
    where: {
      threadId: target.threadId,
      userId: actor.userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toShareDto);
}

async function ownedShare(deps: ShareDeps, actor: Actor, id: string) {
  const row = await deps.prisma.threadShare.findFirst({
    where: { id, userId: actor.userId, spaceId: actor.spaceId },
  });
  if (!row) throw new ORPCError("NOT_FOUND");
  return row;
}

export async function revokeThreadShare(deps: ShareDeps, actor: Actor, input: { id: string }) {
  const row = await ownedShare(deps, actor, input.id);
  await deps.prisma.threadShare.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  return { ok: true as const };
}

export async function removeThreadShare(deps: ShareDeps, actor: Actor, input: { id: string }) {
  const row = await ownedShare(deps, actor, input.id);
  await deps.prisma.threadShare.delete({ where: { id: row.id } });
  return { ok: true as const };
}

/** A share is live when it exists, is not revoked, and has not expired. */
function isLiveShare(row: { revokedAt: Date | null; expiresAt: Date | null } | null): boolean {
  if (!row || row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export async function loadPublicShare(
  deps: ShareDeps,
  token: string,
): Promise<ThreadSharePublic | null> {
  const row = await deps.prisma.threadShare.findUnique({ where: { token } });
  if (!row) return null;
  if (!isLiveShare(row)) return null;
  // Best-effort counter; a failure must not break the view.
  void deps.prisma
    .threadShare.update({ where: { id: row.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);
  const thread = await deps.prisma.thread.findUnique({
    where: { id: row.threadId },
    select: { botId: true },
  });
  let botName = "Bot";
  if (thread?.botId) {
    const bot = await deps.prisma.bot.findUnique({
      where: { id: thread.botId },
      select: { name: true },
    });
    if (bot?.name) botName = bot.name;
  }
  const snapshot = Array.isArray(row.snapshot) ? (row.snapshot as SharedMessage[]) : [];
  return {
    title: row.title,
    botName,
    sharedAt: row.createdAt.toISOString(),
    messages: snapshot,
  };
}

export async function loadPublicShareImage(
  deps: PublicShareDeps,
  token: string,
  artifactId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const row = await deps.prisma.threadShare.findUnique({ where: { token } });
  if (!row) return null;
  if (!isLiveShare(row)) return null;
  const snapshot = Array.isArray(row.snapshot) ? (row.snapshot as SharedMessage[]) : [];
  let mimeType: string | null = null;
  for (const message of snapshot) {
    for (const block of message.blocks) {
      if (block.kind === "image" && block.artifactId === artifactId) {
        mimeType = block.mimeType;
      }
    }
  }
  if (!mimeType) return null;
  const artifact = await deps.prisma.artifact.findUnique({
    where: { id: artifactId },
    select: { storageKey: true, spaceId: true },
  });
  if (!artifact) return null;
  const context: AdapterContext = {
    operationId: `share-image:${token}`,
    traceId: `share-image:${token}`,
    spaceId: artifact.spaceId,
    userId: row.userId,
    signal: new AbortController().signal,
  };
  const bytes = await deps.artifacts.get(artifact.storageKey, context);
  return { bytes, mimeType };
}
