/** Known MCP providers and how to authenticate them on self-hosted installs. */

export type McpAuthPath = "pat" | "oauth_app" | "oauth_dcr" | "pat_or_oauth";

export type McpAuthLinkKind = "create_token" | "docs" | "portal" | "oauth_app" | "catalog";

export type McpAuthLink = {
  href: string;
  kind: McpAuthLinkKind;
};

export type McpAuthProviderId =
  | "github"
  | "canva"
  | "stripe"
  | "slack"
  | "notion"
  | "linear"
  | "figma"
  | "sentry"
  | "airtable"
  | "neon"
  | "todoist"
  | "pagerduty"
  | "huggingface"
  | "atlassian"
  | "asana"
  | "box";

export type McpAuthProviderDef = {
  id: McpAuthProviderId;
  /** Lowercase host / path fragments matched against endpoint + name. */
  hosts: string[];
  path: McpAuthPath;
  links: McpAuthLink[];
};

/** Public catalog used when no provider-specific docs apply. */
export const MCP_AUTH_CATALOG_URL = "https://integrations.sh/";

/**
 * Official token / OAuth setup links for common MCP remotes.
 * Labels are rendered via i18n in McpAuthHelp — keep only stable URLs here.
 */
export const MCP_AUTH_PROVIDERS: readonly McpAuthProviderDef[] = [
  {
    id: "github",
    hosts: ["github.com", "githubcopilot.com", "api.githubcopilot.com"],
    path: "pat",
    links: [
      { kind: "create_token", href: "https://github.com/settings/personal-access-tokens" },
      {
        kind: "docs",
        href: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
      },
      {
        kind: "oauth_app",
        href: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app",
      },
    ],
  },
  {
    id: "canva",
    hosts: ["canva.com", "mcp.canva.com", "api.canva.com"],
    path: "oauth_app",
    links: [
      { kind: "portal", href: "https://www.canva.com/developers/" },
      {
        kind: "docs",
        href: "https://www.canva.com/developers/docs/connect/canva-mcp-server-setup/",
      },
    ],
  },
  {
    id: "stripe",
    hosts: ["stripe.com", "mcp.stripe.com"],
    path: "pat_or_oauth",
    links: [
      { kind: "create_token", href: "https://dashboard.stripe.com/apikeys" },
      { kind: "docs", href: "https://docs.stripe.com/mcp" },
    ],
  },
  {
    id: "slack",
    hosts: ["slack.com", "mcp.slack.com"],
    path: "oauth_app",
    links: [
      { kind: "portal", href: "https://api.slack.com/apps" },
      { kind: "docs", href: "https://docs.slack.dev/ai/mcp-server" },
    ],
  },
  {
    id: "notion",
    hosts: ["notion.com", "mcp.notion.com"],
    path: "oauth_dcr",
    links: [
      { kind: "docs", href: "https://developers.notion.com/docs/get-started-with-mcp" },
      { kind: "portal", href: "https://app.notion.com/developers/connections" },
    ],
  },
  {
    id: "linear",
    hosts: ["linear.app", "mcp.linear.app"],
    path: "oauth_dcr",
    links: [
      { kind: "docs", href: "https://linear.app/docs/mcp" },
      { kind: "create_token", href: "https://linear.app/settings/account/security" },
    ],
  },
  {
    id: "figma",
    hosts: ["figma.com", "mcp.figma.com"],
    path: "oauth_dcr",
    links: [
      {
        kind: "docs",
        href: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
      },
    ],
  },
  {
    id: "sentry",
    hosts: ["sentry.dev", "sentry.io", "mcp.sentry.dev"],
    path: "oauth_dcr",
    links: [{ kind: "docs", href: "https://docs.sentry.io/product/sentry-mcp/" }],
  },
  {
    id: "airtable",
    hosts: ["airtable.com", "mcp.airtable.com"],
    path: "pat_or_oauth",
    links: [
      { kind: "create_token", href: "https://airtable.com/create/tokens" },
      { kind: "docs", href: "https://airtable.com/developers/agents/mcp/other" },
    ],
  },
  {
    id: "neon",
    hosts: ["neon.tech", "mcp.neon.tech"],
    path: "pat_or_oauth",
    links: [{ kind: "create_token", href: "https://console.neon.tech/app/settings/api-keys" }],
  },
  {
    id: "todoist",
    hosts: ["todoist.com", "todoist.net", "ai.todoist.net"],
    path: "pat",
    links: [
      {
        kind: "create_token",
        href: "https://app.todoist.com/app/settings/integrations/developer",
      },
      {
        kind: "docs",
        href: "https://www.todoist.com/help/articles/find-your-api-token-Jpzx9IIlB",
      },
    ],
  },
  {
    id: "pagerduty",
    hosts: ["pagerduty.com", "mcp.pagerduty.com"],
    path: "pat",
    links: [
      { kind: "create_token", href: "https://support.pagerduty.com/docs/api-access-keys" },
      {
        kind: "docs",
        href: "https://developer.pagerduty.com/docs/mcp-tooling-remote-server",
      },
    ],
  },
  {
    id: "huggingface",
    hosts: ["huggingface.co"],
    path: "pat_or_oauth",
    links: [
      { kind: "create_token", href: "https://huggingface.co/settings/tokens" },
      { kind: "docs", href: "https://huggingface.co/docs/hub/en/hf-mcp-server" },
    ],
  },
  {
    id: "atlassian",
    hosts: ["atlassian.com", "mcp.atlassian.com"],
    path: "oauth_dcr",
    links: [
      {
        kind: "docs",
        href: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/",
      },
    ],
  },
  {
    id: "asana",
    hosts: ["asana.com", "mcp.asana.com"],
    path: "oauth_app",
    links: [
      { kind: "portal", href: "https://app.asana.com/0/my-apps" },
      {
        kind: "docs",
        href: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
      },
    ],
  },
  {
    id: "box",
    hosts: ["box.com", "mcp.box.com"],
    path: "oauth_app",
    links: [
      { kind: "portal", href: "https://app.box.com/developers/console" },
      { kind: "docs", href: "https://developer.box.com/guides/box-mcp" },
    ],
  },
] as const;

/** Match a known provider from the MCP endpoint URL and/or display name. */
export function matchMcpAuthProvider(
  endpointOrName: string | null | undefined,
): McpAuthProviderDef | null {
  const haystack = (endpointOrName ?? "").trim().toLowerCase();
  if (!haystack) return null;
  let host = "";
  try {
    if (/^https?:\/\//i.test(haystack)) host = new URL(haystack).hostname.toLowerCase();
  } catch {
    host = "";
  }
  for (const provider of MCP_AUTH_PROVIDERS) {
    // Exact id / name token (avoids "box" matching "sandbox" / "dropbox").
    if (
      haystack === provider.id ||
      new RegExp(`(?:^|[^a-z0-9])${provider.id}(?:[^a-z0-9]|$)`).test(haystack)
    ) {
      return provider;
    }
    if (
      provider.hosts.some(
        (fragment) =>
          (host && (host === fragment || host.endsWith(`.${fragment}`))) ||
          haystack.includes(fragment),
      )
    ) {
      return provider;
    }
  }
  return null;
}
