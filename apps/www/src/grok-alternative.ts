import { DOCS_URL, GITHUB_URL, SITE_URL } from "./site";

export const GROK_ALTERNATIVE_PATH = "/grok-bot-alternative/";

export const GROK_ALTERNATIVE_TITLE =
  "Open Source Grok Bot Alternative (Self-Hosted) – Rakazo";

export const GROK_ALTERNATIVE_DESCRIPTION =
  "Rakazo is an open source, self-hosted Grok Bot alternative. Run persistent AI teammates on your machine, with your model keys, under the Apache-2.0 license.";

export const GROK_ALTERNATIVE_H1 = "Open source, self-hosted Grok Bot alternative";

export const GROK_INTRO = [
  "Rakazo is an open source platform for persistent AI teammates. A bot keeps its own conversations, memory, routines, and history. It can use a browser, a terminal, files, and a graphical desktop, and it can hand work to another bot.",
  "Grok Bot is xAI's hosted product for that kind of work: named bots, a computer they can use, routines, and approvals. Rakazo is the version you can run yourself. The source is Apache-2.0, the server is yours, and you bring the model key.",
] as const;

export const COMPARE_ROWS = [
  {
    topic: "Source",
    rakazo: "Apache-2.0. The application source is on GitHub.",
    grok: "The Grok Bot app does not publish source you can run. Grok Build and the Grok-1 weights are separate open-source releases.",
  },
  {
    topic: "Self-hosting",
    rakazo: "Docker Compose images, or a source checkout, on a machine you control.",
    grok: "A cloud computer on your account. An optional local computer can run approved commands. The docs do not describe deploying the service yourself.",
  },
  {
    topic: "Data and computers",
    rakazo:
      "You run the deployment. Team computers are shared; private computers are isolated. Connector credentials are encrypted on your server and are never returned by the API.",
    grok: "Requires cloud data storage. Bots on one account share one cloud computer, including files and logins. Training opt-out follows the Cursor account settings.",
  },
  {
    topic: "Model",
    rakazo:
      "You bring a key. Documented providers include OpenAI, Anthropic, Google, OpenRouter, Vercel AI Gateway, Cursor, custom servers, and a local model.",
    grok: "Included with paid Cursor plans and SuperGrok subscriptions. The Grok Bot docs do not describe connecting your own model provider.",
  },
  {
    topic: "Price",
    rakazo:
      "No license fee to self-host. You pay your model provider and the computer you run. Hosted Rakazo Cloud is not generally available.",
    grok: "Included with paid individual Cursor plans, Cursor Teams, and SuperGrok subscriptions. SuperGrok is listed at $30/month and includes Grok Bot access. Plans include weekly usage; extra usage can be billed. The free plan on the pricing page does not list Grok Bot.",
  },
  {
    topic: "Apps",
    rakazo: "Web, Electron desktop, and Expo mobile.",
    grok: "Desktop apps for macOS, Windows, and Linux, plus iOS and Android.",
  },
] as const;

export const COMPARE_NOTE =
  "The Grok Bot column follows xAI's public Grok Bot docs and pricing page.";

export const GROK_SOURCES = [
  { label: "Grok Bot overview", href: "https://docs.x.ai/grok-bot/overview" },
  { label: "Grok Bot FAQ", href: "https://docs.x.ai/grok-bot/faq" },
  { label: "xAI pricing", href: "https://x.ai/pricing" },
  { label: "Grok Build source", href: "https://github.com/xai-org/grok-build" },
  { label: "Grok-1 weights", href: "https://github.com/xai-org/grok-1" },
] as const;

export const INSTALL_COMMAND = `mkdir -p rakazo && cd rakazo &&
curl -fsSLO https://raw.githubusercontent.com/elie222/rakazo/main/infra/compose/install-images.sh &&
bash install-images.sh`;

export const SELF_HOST_LEAD =
  "Published images need Docker Engine 26+ (API 1.45+ for bot home volume subpaths), the Compose plugin, curl, and OpenSSL.";

export const SELF_HOST_AFTER = [
  "On this computer, open http://127.0.0.1:5173, create an account, and connect a model. That address is only on the machine running Rakazo. Local Docker computers are on by default.",
  "On a server, run the installer with --prepare-only, set the public HTTPS origin, and create the owner account before anyone else can reach it. The self-hosting guide covers that setup. The desktop app can install the stack on this computer, or connect to an instance you already run.",
] as const;

export const GROK_ALTERNATIVE_FAQ = [
  {
    question: "Is Grok Bot open source?",
    answer:
      "Grok Bot, the hosted teammate app, does not publish its source for you to run. xAI has open-sourced other software: Grok Build, the coding-agent CLI, is Apache-2.0, and the older Grok-1 model weights were released under Apache-2.0. Those projects are not the Grok Bot service. Rakazo is Apache-2.0, and the application source is public on GitHub.",
  },
  {
    question: "Can I self-host Grok Bot?",
    answer:
      "The Grok Bot docs describe a cloud computer assigned to your account. They also describe an optional local computer, where a bot runs approved commands on the machine in front of you. They do not describe installing the Grok Bot service on a server you operate. Rakazo can be self-hosted.",
  },
  {
    question: "How is Rakazo different from Grok Bot?",
    answer:
      "Both are persistent bots that can use a computer, sign in to tools, keep context, and run routines. Grok Bot hosts that computer for you and comes with paid Cursor plans and SuperGrok subscriptions. Rakazo is open source: you host it, you choose the model, and team computers and private computers stay separate. Hosted Rakazo Cloud is not generally available yet.",
  },
] as const;

export function grokAlternativeStructuredData(pageUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${pageUrl}#faq`,
    url: pageUrl,
    mainEntity: GROK_ALTERNATIVE_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function grokAlternativeMarkdown(): string {
  const comparison = [
    "| Topic | Rakazo | Grok Bot |",
    "| --- | --- | --- |",
    ...COMPARE_ROWS.map((row) => `| ${row.topic} | ${row.rakazo} | ${row.grok} |`),
  ].join("\n");
  const sources = GROK_SOURCES.map((source) => `- [${source.label}](${source.href})`).join(
    "\n",
  );
  const faq = GROK_ALTERNATIVE_FAQ.map(
    (item) => `### ${item.question}\n\n${item.answer}`,
  ).join("\n\n");

  return `# ${GROK_ALTERNATIVE_H1}

${GROK_INTRO.join("\n\n")}

## How they compare

${comparison}

${COMPARE_NOTE}

${sources}

## Self-host Rakazo

${SELF_HOST_LEAD}

\`\`\`bash
${INSTALL_COMMAND}
\`\`\`

${SELF_HOST_AFTER.join("\n\n")}

- [Self-hosting guide](${DOCS_URL})
- [Source code](${GITHUB_URL})

## FAQ

${faq}

- [Rakazo](${SITE_URL}/)
- [Sitemap](${SITE_URL}/sitemap-index.xml)
`;
}

export const GROK_ALTERNATIVE_MARKDOWN = grokAlternativeMarkdown();
