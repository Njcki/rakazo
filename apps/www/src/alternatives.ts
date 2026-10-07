import { DOCS_URL, GITHUB_URL, SITE_URL } from "./site";

/** Public descriptions were read on this date. */
export const COMPARED_ON = "October 7, 2026";

export const GET_STARTED = {
  heading: "Get started",
  copy: "Self-hosting is available now. Hosted Rakazo Cloud is not generally available.",
  docsLabel: "Self-hosting guide",
  githubLabel: "View on GitHub",
} as const;

export const OPEN_SOURCE_REASONS = [
  "The source is Apache-2.0 and public on GitHub.",
  "You can run the published Docker images, or a source checkout, on a machine you control. The desktop app can start that stack locally or connect to a server you already run.",
  "You bring the model credentials. Connector credentials are encrypted on the server and are not returned by the API.",
  "Routines are readable Markdown. A bot can pause for approval at a boundary you set, and actions are recorded in an audit log.",
  "The web app, the Electron desktop app, and the Expo mobile app are clients of the same API.",
] as const;

export type ComparisonRow = {
  topic: string;
  rakazo: string;
  other: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export type SourceLink = {
  label: string;
  href: string;
};

export type Alternative = {
  /** Path segment. The page is served at `/${slug}/`. */
  slug: string;
  /** Short product name used on the hub. */
  name: string;
  /** One sentence under the hub link. */
  summary: string;
  title: string;
  description: string;
  h1: string;
  /** Column heading for the other product. */
  otherName: string;
  intro: readonly string[];
  rows: readonly ComparisonRow[];
  faq: readonly FaqItem[];
  sources: readonly SourceLink[];
};

export const ALTERNATIVES_HUB = {
  title: "Open Source AI Assistant Alternatives – Rakazo",
  description:
    "Open source comparisons of Rakazo with other AI assistants, including Meta's Muse and OpenAI's Dots.",
  h1: "Open source alternatives",
  intro:
    "Rakazo is an open source platform for persistent AI teammates you can run yourself. These pages compare it with other AI assistants using their public descriptions.",
} as const;

const MUSE_SOURCES = [
  {
    label: "Meta, Introducing Muse (September 8, 2026)",
    href: "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/",
  },
  {
    label: "Meta, Connect 2026 recap (September 23, 2026)",
    href: "https://www.meta.com/blog/meta-connect-2026-everything-we-announced/",
  },
  {
    label: "Meta, Muse for Small Business (September 29, 2026)",
    href: "https://about.fb.com/news/2026/09/introducing-muse-small-business/",
  },
] as const satisfies readonly SourceLink[];

const DOTS_SOURCES = [
  {
    label: "OpenAI, Introducing dots (September 29, 2026)",
    href: "https://openai.com/index/introducing-dots/",
  },
  {
    label: "OpenAI Help Center, Dots privacy, security, and safety FAQs",
    href: "https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs",
  },
] as const satisfies readonly SourceLink[];

/**
 * Comparison pages. Add an entry here to publish `/${slug}/` and a hub card.
 */
export const ALTERNATIVES: readonly Alternative[] = [
  {
    slug: "muse-alternative",
    name: "Muse",
    summary: "Meta's personal AI agent, and what is different when you host Rakazo yourself.",
    title: "Open Source Muse Alternative – Rakazo",
    description:
      "Rakazo is an open source, self-hostable platform for persistent AI teammates. Compare it with Meta's Muse personal agent.",
    h1: "Open source Muse alternative",
    otherName: "Muse",
    intro: [
      "Muse is Meta's personal AI agent, introduced on September 8, 2026. It runs on a virtual machine Meta operates, and you talk to it in the Muse app or WhatsApp. Meta says it can keep working after you close the app.",
      "Rakazo is open source software for persistent AI teammates. You choose the model and the computer, and you can run the stack yourself. This is a comparison of public descriptions, not a measured benchmark.",
    ],
    rows: [
      {
        topic: "Product",
        rakazo: "Open source platform for persistent AI teammates. Rakazo is in beta.",
        other:
          "Meta's personal AI agent. Meta says it takes on tasks and longer-term goals, rather than only answering questions.",
      },
      {
        topic: "Who runs it",
        rakazo:
          "You do. Self-host with Docker, or point the desktop and mobile apps at a server you operate. Hosted Rakazo Cloud is not generally available.",
        other:
          "Meta. Muse runs on Muse Secure VM, a dedicated cloud virtual machine for the agent and for data from services you connect. Meta's September 29, 2026 post describes Muse as available in the US and Canada.",
      },
      {
        topic: "Source",
        rakazo: "Apache-2.0 source on GitHub.",
        other: "Hosted service from Meta.",
      },
      {
        topic: "Model",
        rakazo:
          "Bring your own model credentials. Multiple providers are supported, including a custom model server.",
        other: "Muse Spark, which Meta's launch post describes as the model for this agent.",
      },
      {
        topic: "Computer",
        rakazo:
          "Sandboxed browser, terminal, files, and a graphical desktop, on a shared team computer or an isolated private computer. Docker is the default local computer, with optional E2B, Daytona, CreateOS, Box, or a trusted local computer.",
        other:
          "A browser on Muse Secure VM. Meta says Muse can open that browser, fill out forms, and take on tasks such as email and booking travel. The Connect recap says Muse for Mac can drive apps on that Mac with your permission.",
      },
      {
        topic: "Connected apps",
        rakazo:
          "Composio or Pipedream Connect, or a Treg, remote MCP, or OpenAPI source you install. Connector credentials are encrypted on the server and are not returned by the API.",
        other:
          "You choose which apps Muse can use and how much access each one gets. Meta publishes connectors, including work and shopping tools, and custom connectors.",
      },
      {
        topic: "Ongoing work",
        rakazo:
          "Each bot keeps its own conversations, memory, routines, and history. Routines are readable Markdown and can run on a schedule. A bot can delegate to a peer bot or a short-lived subagent.",
        other:
          "Meta says Muse keeps working after you close the app and comes back when something changes or it needs approval.",
      },
      {
        topic: "Approval",
        rakazo:
          "A bot can pause for approval when a task crosses a boundary you set. Actions are recorded in an audit log.",
        other:
          "Meta says Muse checks with you before sensitive actions such as sending an email or paying, and shows an audit trail. The small-business post says nothing publishes, sends, or spends without your approval. You can opt out of using interactions to train Meta's models. Meta says conversations and VM data are not shared with Meta's ad systems, and that stored credentials can be used without Muse seeing the passwords.",
      },
      {
        topic: "Where you use it",
        rakazo:
          "Web app, Electron desktop app, and Expo mobile app. Voice can speak replies, take dictation, and call a bot, with your own ElevenLabs, OpenAI, Cartesia, or Fish Audio key.",
        other:
          "Muse app on iOS and Android, WhatsApp, and muse.ai, per the launch. The Connect recap adds the Mac app, a voice mode you can shape, and Muse on AI glasses in the coming months.",
      },
    ],
    faq: [
      {
        question: "Is Rakazo a replacement for Muse?",
        answer:
          "No. Muse is Meta's hosted personal agent, with the Muse app, WhatsApp, and a virtual machine Meta operates. Rakazo is open source software for persistent AI teammates on infrastructure you control. Both can keep working beyond a single chat. They differ on hosting, model choice, and which products are built in.",
      },
      {
        question: "Can I self-host Rakazo?",
        answer:
          "Yes. Self-hosting is available now with published Docker images or a source checkout. Hosted Rakazo Cloud is not generally available.",
      },
      {
        question: "Does Rakazo include Muse on WhatsApp, shopping checkout, or AI glasses?",
        answer:
          "No. Those are Muse surfaces Meta describes. Rakazo's clients are the web app, the Electron desktop app, and the Expo mobile app. Voice in Rakazo uses a key you bring for ElevenLabs, OpenAI, Cartesia, or Fish Audio.",
      },
      {
        question: "Where do the Muse details come from?",
        answer:
          "The Muse column summarizes Meta's September 8, 2026 launch, the September 23, 2026 Connect recap, and the September 29, 2026 small-business post. Check those posts before you rely on a specific capability.",
      },
    ],
    sources: MUSE_SOURCES,
  },
  {
    slug: "dots-alternative",
    name: "Dots",
    summary: "OpenAI's always-on agents, in a shorter comparison.",
    title: "Open Source Dots Alternative – Rakazo",
    description:
      "Rakazo is an open source, self-hostable platform for persistent AI teammates. Compare it with OpenAI's Dots agents.",
    h1: "Open source Dots alternative",
    otherName: "Dots",
    intro: [
      "Dots are OpenAI's always-on agents, announced on September 29, 2026. OpenAI says they use GPT-6 Astra, have their own cloud computer, and are rolling out on eligible Pro, Business Premium, and Enterprise plans.",
      "Rakazo is separate software: open source AI teammates you can host yourself, with model credentials you bring.",
    ],
    rows: [
      {
        topic: "Product",
        rakazo: "Open source platform for persistent AI teammates. Rakazo is in beta.",
        other:
          "Always-on agents from OpenAI. OpenAI says a dot learns from feedback and can work toward your goals continuously.",
      },
      {
        topic: "Who runs it",
        rakazo:
          "You do. Self-host with Docker, or point the desktop and mobile apps at a server you operate. Hosted Rakazo Cloud is not generally available.",
        other: "OpenAI. The announcement says each dot has its own cloud computer.",
      },
      {
        topic: "Source",
        rakazo: "Apache-2.0 source on GitHub.",
        other: "Hosted product from OpenAI.",
      },
      {
        topic: "Model",
        rakazo:
          "Bring your own model credentials. Multiple providers are supported, including a custom model server.",
        other: "GPT-6 Astra, according to OpenAI's announcement.",
      },
      {
        topic: "Connections",
        rakazo:
          "Composio or Pipedream Connect, or a Treg, remote MCP, or OpenAPI source you install. Bots also get a sandboxed browser, terminal, files, and a graphical desktop.",
        other:
          "OpenAI says plugins connect a dot to more than 4,000 apps, and those permissions are shared with ChatGPT. The help center says you can also give a dot its own Slack account.",
      },
      {
        topic: "Ongoing work",
        rakazo:
          "Each bot keeps conversations, memory, routines, and history. Routines are readable Markdown and can run on a schedule. A bot can delegate to a peer bot or a short-lived subagent.",
        other:
          "OpenAI says a dot can keep working in the background. Proactive research can read permitted sources and save private notes. The help center says that research cannot send messages, change content through plugins, or control a browser or computer.",
      },
      {
        topic: "Control and availability",
        rakazo:
          "A bot can pause for approval at a boundary you set, and actions are recorded in an audit log. The web, desktop, and mobile clients are available with self-hosting now.",
        other:
          "Built-in rules and Custom Rules say what a dot may do, must ask about, or must not do. Custom Rules cannot turn off core safety checks. The help center says changing a password or transferring money requires you to take over, and Activity View shows ongoing work. The first dot is included with Pro and Business Premium. Dots are not available to users under 18. OpenAI is also previewing specialist dots for organizations.",
      },
    ],
    faq: [
      {
        question: "Is Rakazo a replacement for a dot?",
        answer:
          "No. A dot is an OpenAI agent on an eligible ChatGPT plan. Rakazo is open source software you run yourself, with your own model credentials.",
      },
      {
        question: "Do I need an OpenAI account to use Rakazo?",
        answer:
          "No. OpenAI is one supported model connection, not a requirement. You bring credentials for a provider you choose.",
      },
      {
        question: "Where do the Dots details come from?",
        answer:
          "The Dots column summarizes OpenAI's September 29, 2026 announcement and OpenAI's Dots privacy, security, and safety FAQ. Check those pages before you rely on a specific capability.",
      },
    ],
    sources: DOTS_SOURCES,
  },
];

export function alternativePath(alternative: Pick<Alternative, "slug">): string {
  return `/${alternative.slug}/`;
}

export function faqPageSchema(faq: readonly FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function alternativeMarkdown(alternative: Alternative): string {
  const lines = [
    `# ${alternative.h1}`,
    "",
    ...alternative.intro.flatMap((paragraph) => [paragraph, ""]),
    `Public descriptions as of ${COMPARED_ON}.`,
    "",
    "## Comparison",
    "",
    `| Topic | Rakazo | ${alternative.otherName} |`,
    "| --- | --- | --- |",
    ...alternative.rows.map(
      (row) => `| ${cell(row.topic)} | ${cell(row.rakazo)} | ${cell(row.other)} |`,
    ),
    "",
    "## Why open source and self-hosted",
    "",
    ...OPEN_SOURCE_REASONS.map((reason) => `- ${reason}`),
    "",
    `## ${GET_STARTED.heading}`,
    "",
    GET_STARTED.copy,
    "",
    `- [${GET_STARTED.docsLabel}](${DOCS_URL})`,
    `- [${GET_STARTED.githubLabel}](${GITHUB_URL})`,
    "",
    "## FAQ",
    "",
    ...alternative.faq.flatMap((item) => [`### ${item.question}`, "", item.answer, ""]),
    "## Sources",
    "",
    ...alternative.sources.map((source) => `- [${source.label}](${source.href})`),
    "",
  ];
  return lines.join("\n");
}

export function alternativesIndexMarkdown(): string {
  const pages = ALTERNATIVES.map(
    (alternative) =>
      `- [${alternative.h1}](${SITE_URL}${alternativePath(alternative)}) — ${alternative.name}`,
  );
  return [
    `# ${ALTERNATIVES_HUB.h1}`,
    "",
    ALTERNATIVES_HUB.intro,
    "",
    `Public descriptions as of ${COMPARED_ON}.`,
    "",
    "## Pages",
    "",
    ...pages,
    "",
    `## ${GET_STARTED.heading}`,
    "",
    GET_STARTED.copy,
    "",
    `- [${GET_STARTED.docsLabel}](${DOCS_URL})`,
    `- [${GET_STARTED.githubLabel}](${GITHUB_URL})`,
    "",
  ].join("\n");
}
