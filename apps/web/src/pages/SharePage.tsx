import { Trans, useLingui } from "@lingui/react/macro";
import type { ThreadSharePublic } from "@rakazo/contracts";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { Spinner } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; data: ThreadSharePublic };

function shareImageUrl(token: string, artifactId: string): string {
  return `/api/share/${encodeURIComponent(token)}/image/${encodeURIComponent(artifactId)}`;
}

/**
 * Public, read-only view of a shared conversation. No login required: the token
 * in the URL is the only credential, and the content is a frozen snapshot.
 */
export function SharePage() {
  const { token = "" } = useParams();
  const { t } = useLingui();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void fetch(`/api/share/${encodeURIComponent(token)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (response.status === 404) return { status: "not-found" } as const;
        if (!response.ok) return { status: "error" } as const;
        const data = (await response.json()) as ThreadSharePublic;
        return { status: "ready", data } as const;
      })
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === "loading") {
    return (
      <Centered>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          <Trans>Loading…</Trans>
        </div>
      </Centered>
    );
  }
  if (state.status === "not-found") {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-[17px] font-medium text-foreground">
            <Trans>This share link is not available.</Trans>
          </p>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            <Trans>It may have been revoked or expired.</Trans>
          </p>
        </div>
      </Centered>
    );
  }
  if (state.status === "error") {
    return (
      <Centered>
        <p className="text-[15px] text-destructive">
          <Trans>Something went wrong loading this share.</Trans>
        </p>
      </Centered>
    );
  }

  const { data } = state;
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[720px] px-4 py-10 md:px-6">
        <header className="mb-6 border-b border-input pb-4">
          <h1 className="text-[20px] font-semibold text-foreground">
            {data.title ?? data.botName}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              Conversation with {data.botName} · shared {new Date(data.sharedAt).toLocaleDateString()}
            </Trans>
          </p>
        </header>

        <ol className="flex flex-col gap-4">
          {data.messages.map((message, index) => (
            <li key={index} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-muted-foreground">
                {message.authorName}
              </span>
              <div className="flex flex-col gap-2">
                {message.blocks.map((block, blockIndex) =>
                  block.kind === "text" ? (
                    <div
                      key={blockIndex}
                      className="break-words text-[14.5px] leading-relaxed text-foreground"
                      dir="auto"
                    >
                      <ChatMarkdown>{block.text}</ChatMarkdown>
                    </div>
                  ) : (
                    <img
                      key={blockIndex}
                      src={shareImageUrl(token, block.artifactId)}
                      alt={block.name}
                      loading="lazy"
                      className="max-h-[420px] max-w-full rounded-lg border border-input"
                    />
                  ),
                )}
              </div>
            </li>
          ))}
        </ol>

        <footer className="mt-8 border-t border-input pt-3 text-[12px] text-muted-foreground">
          <Trans>Shared from Rakazo</Trans>
        </footer>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">{children}</div>
  );
}
