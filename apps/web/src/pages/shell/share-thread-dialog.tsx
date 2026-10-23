import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageBlock, ThreadMessage, ThreadShare } from "@rakazo/contracts";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Separator,
  Spinner,
} from "@rakazo/ui-web";
import { Check, Copy, Link2, Share2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCopyText } from "../../lib/copy-text";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** The block kinds that leave the instance in a public share. */
function shareableBlocks(blocks: MessageBlock[]): MessageBlock[] {
  return blocks.filter(
    (block) => (block.kind === "text" && block.text.trim()) || block.kind === "image",
  );
}

function messagePreview(blocks: MessageBlock[]): string {
  for (const block of blocks) {
    if (block.kind === "text" && block.text.trim()) {
      const text = block.text.trim().replace(/\s+/g, " ");
      return text.length > 90 ? `${text.slice(0, 90)}…` : text;
    }
  }
  if (blocks.some((block) => block.kind === "image")) return "🖼";
  return "";
}

const EXPIRY_OPTIONS = [
  { value: "", label: "no-expiry" },
  { value: "7", label: "7-days" },
  { value: "30", label: "30-days" },
  { value: "90", label: "90-days" },
] as const;

/**
 * Create and manage public, link-shareable snapshots of a 1:1 bot thread.
 * The owner picks which messages to include; the resulting link needs no login.
 */
export function ShareThreadDialog({
  botId,
  botName,
  onClose,
}: {
  botId: string;
  botName: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [expiry, setExpiry] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [shares, setShares] = useState<ThreadShare[]>([]);
  const [copied, copy] = useCopyText();

  const loadAll = useCallback(async () => {
    let all: ThreadMessage[] = [];
    let before: number | undefined;
    for (;;) {
      const page = await rpc.threads.messages({ botId, before });
      all = [...page.messages, ...all];
      if (page.olderCursor == null) break;
      before = page.olderCursor;
    }
    return all;
  }, [botId]);

  useEffect(() => {
    let cancelled = false;
    void loadAll()
      .then((all) => {
        if (cancelled) return;
        setMessages(all);
        setSelected(new Set(all.filter((m) => shareableBlocks(m.blocks).length > 0).map((m) => m.id)));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(errorText(reason, t`Could not load messages`));
      });
    void rpc.threadShares
      .list({ botId })
      .then((rows) => {
        if (!cancelled) setShares(rows);
      })
      .catch(() => {
        if (!cancelled) setShares([]);
      });
    return () => {
      cancelled = true;
    };
  }, [botId, loadAll, t]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectable = useMemo(
    () => (messages ?? []).filter((m) => shareableBlocks(m.blocks).length > 0),
    [messages],
  );
  const allSelected = selectable.length > 0 && selectable.every((m) => selected.has(m.id));

  const setAll = (value: boolean) => {
    setSelected(value ? new Set(selectable.map((m) => m.id)) : new Set());
  };

  const create = async () => {
    const messageIds = (messages ?? [])
      .filter((m) => selected.has(m.id))
      .map((m) => m.id);
    if (messageIds.length === 0 || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await rpc.threadShares.create({
        botId,
        messageIds,
        title: title.trim() || undefined,
        expiresInDays: expiry === "" ? undefined : Number(expiry),
      });
      setCreatedUrl(result.url);
      void copy(result.url);
      setShares(await rpc.threadShares.list({ botId }));
    } catch (reason: unknown) {
      setCreateError(errorText(reason, t`Could not create the share`));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await rpc.threadShares.revoke({ id });
      setShares(await rpc.threadShares.list({ botId }));
    } catch (reason: unknown) {
      setCreateError(errorText(reason, t`Could not revoke the share`));
    }
  };

  const busy = creating;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-[640px]">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2.5">
            <Share2 size={17} strokeWidth={1.8} className="text-muted-foreground" aria-hidden="true" />
            <Trans>Share conversation</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Pick the messages to include. The link is public: anyone who has it can read the
              conversation without an account. Only text and images are shared.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-[13.5px] text-destructive">{loadError}</p>
        ) : messages === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Spinner />
            <Trans>Loading messages…</Trans>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center justify-between px-1">
              <Label className="text-[13px] text-muted-foreground">
                <Trans>{selected.size} of {selectable.length} messages</Trans>
              </Label>
              <div className="flex items-center gap-3 text-[13px]">
                <button type="button" className="text-foreground/75 hover:text-foreground" onClick={() => setAll(true)}>
                  <Trans>Select all</Trans>
                </button>
                <button type="button" className="text-foreground/75 hover:text-foreground" onClick={() => setAll(false)}>
                  <Trans>Clear</Trans>
                </button>
              </div>
            </div>

            <ScrollArea className="max-h-[280px] min-w-0 rounded-lg border border-input">
              <ul className="divide-y divide-input">
                {selectable.map((message) => {
                  const checked = selected.has(message.id);
                  return (
                    <li
                      key={message.id}
                      className="flex cursor-pointer select-none items-start gap-3 px-3 py-2 hover:bg-accent/40"
                      onClick={() => toggle(message.id)}
                    >
                      <Checkbox
                        aria-label={messagePreview(shareableBlocks(message.blocks)) || t`Message`}
                        checked={checked}
                        onCheckedChange={() => toggle(message.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-muted-foreground">
                          {message.role === "user" ? t`You` : botName}
                        </div>
                        <div className="truncate text-[13.5px] text-foreground" dir="auto">
                          {messagePreview(shareableBlocks(message.blocks)) || "—"}
                        </div>
                      </div>
                    </li>
                  );
                })}
                {selectable.length === 0 ? (
                  <li className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">
                    <Trans>This conversation has no shareable messages yet.</Trans>
                  </li>
                ) : null}
              </ul>
            </ScrollArea>

            <div className="grid min-w-0 gap-3">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="share-title" className="text-[13px] text-muted-foreground">
                  <Trans>Title (optional)</Trans>
                </Label>
                <Input
                  id="share-title"
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={botName}
                />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label className="text-[13px] text-muted-foreground">
                  <Trans>Link expires</Trans>
                </Label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {EXPIRY_OPTIONS.map((option) => {
                    const active = expiry === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setExpiry(option.value)}
                        className={
                          active
                            ? "rounded-lg border border-input bg-accent px-2 py-1.5 text-[13px] font-medium text-foreground"
                            : "rounded-lg border border-transparent px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                        }
                      >
                        {option.value === ""
                          ? t`No expiration`
                          : t`After ${option.value} days`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {createError ? <p className="text-[13.5px] text-destructive">{createError}</p> : null}

            {createdUrl ? (
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-input bg-accent/40 p-2">
                <Link2 size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-all text-[13px] text-foreground" dir="ltr">
                  {createdUrl}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(createdUrl)}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                  <Trans>{copied ? "Copied" : "Copy"}</Trans>
                </Button>
              </div>
            ) : null}
          </>
        )}

        <Separator />

        <div className="grid min-w-0 gap-1.5">
          <Label className="text-[13px] font-medium text-muted-foreground">
            <Trans>Active shares</Trans>
          </Label>
          {shares.length === 0 ? (
            <p className="px-1 text-[13px] text-muted-foreground">
              <Trans>No active shares.</Trans>
            </p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
              {shares.map((share) => (
                <li
                  key={share.id}
                  className="flex items-center gap-2 rounded-lg border border-input px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-foreground">
                      {share.title ?? t`Untitled share`}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      <Trans>{share.messageCount} messages</Trans>
                      {share.expiresAt ? (
                        <>
                          {" · "}
                          <Trans>expires {new Date(share.expiresAt).toLocaleDateString()}</Trans>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copy(`${window.location.origin}/share/${share.token}`)}
                    className="shrink-0"
                  >
                    <Copy size={14} aria-hidden="true" />
                    <Trans>Copy link</Trans>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(share.id)}
                    className="shrink-0 text-destructive hover:text-destructive"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <Trans>Revoke</Trans>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="min-w-0">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
          <Button type="button" onClick={() => void create()} disabled={busy || messages === null}>
            {busy ? <Spinner /> : <Share2 size={15} aria-hidden="true" />}
            <Trans>Create link</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
