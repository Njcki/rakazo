import { describe, expect, it } from "vitest";
import {
  ALTERNATIVES,
  ALTERNATIVES_HUB,
  HUB_CARDS,
  alternativeMarkdown,
  alternativePath,
  alternativesIndexMarkdown,
  faqPageSchema,
} from "./alternatives";
import { getMarkdownAlternate, getMarkdownDocument } from "./agent-content";

describe("alternative pages", () => {
  it("publishes Muse and Dots from one list the hub can render", () => {
    expect(ALTERNATIVES.map((page) => page.slug)).toEqual([
      "muse-alternative",
      "dots-alternative",
      "instinct-alternative",
      "hermes-alternative",
    ]);
    expect(new Set(ALTERNATIVES.map((page) => page.slug)).size).toBe(ALTERNATIVES.length);

    const index = alternativesIndexMarkdown();
    expect(index.startsWith(`# ${ALTERNATIVES_HUB.h1}\n`)).toBe(true);
    expect(HUB_CARDS.map((card) => card.href)).toEqual([
      "/muse-alternative/",
      "/dots-alternative/",
      "/instinct-alternative/",
      "/hermes-alternative/",
      "/grok-bot-alternative/",
      "/openclaw-alternative/",
    ]);
    expect(new Set(HUB_CARDS.map((card) => card.href)).size).toBe(HUB_CARDS.length);
    for (const card of HUB_CARDS) {
      expect(index.split(card.href).length - 1).toBe(1);
    }
    for (const page of ALTERNATIVES) {
      expect(page.title).toContain("Rakazo");
      expect(page.h1.length).toBeGreaterThan(0);
      expect(page.description.length).toBeGreaterThan(0);
      expect(page.rows.length).toBeGreaterThan(0);
      expect(page.faq.length).toBeGreaterThan(0);
      expect(index).toContain(alternativePath(page));
      for (const row of page.rows) {
        expect(row.topic.includes("|")).toBe(false);
        expect(row.rakazo.includes("|")).toBe(false);
        expect(row.other.includes("|")).toBe(false);
      }
    }
  });

  it("keeps FAQ structured data identical to the visible questions and answers", () => {
    for (const page of ALTERNATIVES) {
      const schema = faqPageSchema(page.faq);
      expect(schema["@type"]).toBe("FAQPage");
      expect(schema.mainEntity).toEqual(
        page.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      );
    }
  });

  it("serves the same comparison as Markdown on the page URL", () => {
    expect(getMarkdownDocument("/alternatives/")).toContain(`# ${ALTERNATIVES_HUB.h1}`);
    expect(getMarkdownAlternate("/alternatives/")).toBe("/alternatives.md");

    const hermes = ALTERNATIVES.find((page) => page.slug === "hermes-alternative");
    expect(hermes?.sections?.map((section) => section.heading)).toEqual([
      "Setup",
      "Day-to-day management",
    ]);
    expect(hermes?.intro.join(" ")).toContain("just chat");
    expect(hermes?.sections?.[0]?.paragraphs.join(" ")).toContain("Choose provider later");
    expect(hermes?.sources.some((source) => source.href.endsWith("/docs/user-guide/desktop"))).toBe(
      true,
    );

    for (const page of ALTERNATIVES) {
      const markdown = alternativeMarkdown(page);
      expect(markdown.startsWith(`# ${page.h1}\n`)).toBe(true);
      for (const section of page.sections ?? []) {
        expect(markdown).toContain(`## ${section.heading}`);
      }
      expect(getMarkdownDocument(alternativePath(page))).toBe(markdown);
      expect(getMarkdownAlternate(`/${page.slug}`)).toBe(`/${page.slug}.md`);
      for (const item of page.faq) {
        expect(markdown).toContain(`### ${item.question}`);
        expect(markdown).toContain(item.answer);
      }
    }
  });
});
