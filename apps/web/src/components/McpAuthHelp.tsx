import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import { useMemo } from "react";
import { useCopyText } from "../lib/copy-text";
import {
  MCP_AUTH_CATALOG_URL,
  type McpAuthLink,
  type McpAuthLinkKind,
  type McpAuthPath,
  type McpAuthProviderDef,
  type McpAuthProviderId,
  matchMcpAuthProvider,
} from "../lib/mcp-auth-help";
import { mcpOAuthRedirectUri } from "../lib/mcp-connect";

function providerTitle(id: McpAuthProviderId): string {
  switch (id) {
    case "github":
      return "GitHub";
    case "canva":
      return "Canva";
    case "stripe":
      return "Stripe";
    case "slack":
      return "Slack";
    case "notion":
      return "Notion";
    case "linear":
      return "Linear";
    case "figma":
      return "Figma";
    case "sentry":
      return "Sentry";
    case "airtable":
      return "Airtable";
    case "neon":
      return "Neon";
    case "todoist":
      return "Todoist";
    case "pagerduty":
      return "PagerDuty";
    case "huggingface":
      return "Hugging Face";
    case "atlassian":
      return "Atlassian";
    case "asana":
      return "Asana";
    case "box":
      return "Box";
  }
}

function LinkLabel({ kind }: { kind: McpAuthLinkKind }) {
  switch (kind) {
    case "create_token":
      return <Trans>Create access token</Trans>;
    case "docs":
      return <Trans>Official docs</Trans>;
    case "portal":
      return <Trans>Developer portal</Trans>;
    case "oauth_app":
      return <Trans>Create OAuth app</Trans>;
    case "catalog":
      return <Trans>Browse catalog</Trans>;
  }
}

function PathHint({ path }: { path: McpAuthPath }) {
  switch (path) {
    case "pat":
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Paste a personal access token in Access token, then Save. Do not use Connect OAuth for
            this provider on self-hosted installs.
          </Trans>
        </p>
      );
    case "oauth_app":
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Create an app in the developer portal, allowlist the redirect URI below, then put the
            client ID and secret under Advanced and use Connect OAuth.
          </Trans>
        </p>
      );
    case "oauth_dcr":
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Try Connect OAuth first. If you get an invalid redirect URI error, create an app and
            allowlist the redirect URI below, then fill Advanced client ID and secret.
          </Trans>
        </p>
      );
    case "pat_or_oauth":
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Either paste an API token in Access token and Save, or use Connect OAuth (Advanced
            client fields if redirect is rejected).
          </Trans>
        </p>
      );
  }
}

function HelpLinks({ links }: { links: readonly McpAuthLink[] }) {
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {links.map((link) => (
        <li key={`${link.kind}:${link.href}`}>
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline-offset-2 hover:underline"
          >
            <LinkLabel kind={link.kind} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function RedirectUriRow() {
  const { t } = useLingui();
  const [copied, copy] = useCopyText();
  const uri = typeof window === "undefined" ? "" : mcpOAuthRedirectUri();
  if (!uri) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">
        <Trans>OAuth redirect URI</Trans>
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground">
          {uri}
        </code>
        <Button type="button" variant="outline" size="xs" onClick={() => copy(uri)}>
          {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        <Trans>Add this exact URL to the provider app redirect allowlist.</Trans>
      </p>
      <span className="sr-only">{t`OAuth callback URL`}</span>
    </div>
  );
}

function ProviderBlock({ provider }: { provider: McpAuthProviderDef }) {
  const title = providerTitle(provider.id);
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <p className="text-xs font-medium text-foreground">
        <Trans>Setup for {title}</Trans>
      </p>
      <PathHint path={provider.path} />
      <HelpLinks links={provider.links} />
      <RedirectUriRow />
    </div>
  );
}

/** Contextual PAT / OAuth guidance for MCP server setup (self-hosted). */
export function McpAuthHelp({
  endpoint,
  name,
  defaultOpen = false,
}: {
  /** MCP server URL — used to pick provider-specific links. */
  endpoint?: string | null;
  /** Display / search name fallback for matching. */
  name?: string | null;
  defaultOpen?: boolean;
}) {
  const provider = useMemo(
    () => matchMcpAuthProvider(endpoint) ?? matchMcpAuthProvider(name),
    [endpoint, name],
  );

  return (
    <div className="space-y-2">
      {provider ? <ProviderBlock provider={provider} /> : null}
      <Disclosure
        defaultOpen={defaultOpen || !provider}
        className="rounded-xl border border-border"
        summary={
          <span className="text-sm text-foreground">
            <Trans>How to get a token or OAuth app</Trans>
          </span>
        }
        summaryClassName="w-full flex items-center justify-between px-3 py-2.5"
        contentClassName="border-t border-border"
      >
        <div className="space-y-3 p-3">
          <p className="text-xs text-muted-foreground">
            <Trans>
              Access token + Save for a PAT or API key. Advanced client ID/secret + Connect OAuth
              when the provider needs an app. On self-hosted installs, allowlist the redirect URI
              below.
            </Trans>
          </p>
          <RedirectUriRow />
          {!provider ? (
            <p className="text-xs text-muted-foreground">
              <Trans>
                Unknown provider — check the catalog for auth details, then use Access token or
                Advanced OAuth as above.
              </Trans>{" "}
              <a
                href={MCP_AUTH_CATALOG_URL}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                integrations.sh
              </a>
            </p>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
