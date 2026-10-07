import { describe, expect, it } from "vitest";
import {
  ALTERNATIVES,
  ALTERNATIVES_HUB,
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
    ]);
    expect(new Set(ALTERNATIVES.map((page) => page.slug)).size).toBe(ALTERNATIVES.length);

    const index = alternativesIndexMarkdown();
    expect(index.startsWith(`# ${ALTERNATIVES_HUB.h1}\n`)).toBe(true);
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

    for (const page of ALTERNATIVES) {
      const markdown = alternativeMarkdown(page);
      expect(markdown.startsWith(`# ${page.h1}\n`)).toBe(true);
      expect(getMarkdownDocument(alternativePath(page))).toBe(markdown);
      expect(getMarkdownAlternate(`/${page.slug}`)).toBe(`/${page.slug}.md`);
      for (const item of page.faq) {
        expect(markdown).toContain(`### ${item.question}`);
        expect(markdown).toContain(item.answer);
      }
    }
  });
});
