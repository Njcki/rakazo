import { describe, expect, it } from "vitest";
import { getHomeCopy } from "./i18n/home";
import {
  GROK_ALTERNATIVE_FAQ,
  GROK_ALTERNATIVE_MARKDOWN,
  grokAlternativeStructuredData,
} from "./grok-alternative";

describe("Grok Bot alternative page", () => {
  it("keeps FAQ JSON-LD identical to the visible questions and answers", () => {
    const data = grokAlternativeStructuredData("https://rakazo.com/grok-bot-alternative/");
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity).toHaveLength(GROK_ALTERNATIVE_FAQ.length);

    for (const [index, item] of GROK_ALTERNATIVE_FAQ.entries()) {
      const entity = data.mainEntity[index];
      expect(entity?.name).toBe(item.question);
      expect(entity?.acceptedAnswer.text).toBe(item.answer);
      expect(GROK_ALTERNATIVE_MARKDOWN).toContain(`### ${item.question}`);
      expect(GROK_ALTERNATIVE_MARKDOWN).toContain(item.answer);
    }
  });
});

describe("homepage headings", () => {
  it("names the open source, self-hosted Grok Bot alternative in English headings", () => {
    const copy = getHomeCopy("en");
    expect(copy.hero.heading).toBe(
      "The open source Grok Bot alternative you actually own",
    );
    expect(copy.selfHost.heading).toBe("Self-hosted. The computer is yours.");
    expect(copy.openSource.heading).toBe("Open source. Just the repo.");
    expect(copy.nav.grokBot).toBe("Grok Bot");
    expect(copy.footer.links.grokAlternative).toBe("Grok Bot alternative");
  });
});

describe("self-host quick start", () => {
  it("names the Docker minimum and keeps remote setup private until the owner exists", async () => {
    expect(GROK_ALTERNATIVE_MARKDOWN).toContain("Docker Engine 26+");
    expect(GROK_ALTERNATIVE_MARKDOWN).toContain("--prepare-only");
    expect(GROK_ALTERNATIVE_MARKDOWN).toContain("only on the machine running Rakazo");
  });
});
