import { describe, expect, it } from "vitest";
import { mathToPlainText, normalizeMathMarkdown, texToUnicode } from "./math";

describe("normalizeMathMarkdown", () => {
  it("keeps inline math that follows the Pandoc rules", () => {
    expect(normalizeMathMarkdown("Pressione $1018.86\\text{hPa}$ oggi")).toBe(
      "Pressione $1018.86\\text{hPa}$ oggi",
    );
  });

  it("escapes dollars that are prices, not math", () => {
    expect(normalizeMathMarkdown("costa $5 o $10")).toBe("costa \\$5 o \\$10");
    expect(normalizeMathMarkdown("da $5-$10 al mese")).toBe("da \\$5-\\$10 al mese");
    expect(normalizeMathMarkdown("$ 5 e 6 $")).toBe("\\$ 5 e 6 \\$");
  });

  it("turns display math alone on a line into a block", () => {
    expect(normalizeMathMarkdown("Energia:\n$$E=mc^2$$\nfine")).toBe(
      "Energia:\n$$\nE=mc^2\n$$\nfine",
    );
  });

  it("keeps display math inside a sentence inline", () => {
    expect(normalizeMathMarkdown("dove $$x$$ è")).toBe("dove $$x$$ è");
  });

  it("rewrites \\( \\) and \\[ \\]", () => {
    expect(normalizeMathMarkdown("area \\(\\pi r^2\\)")).toBe("area $\\pi r^2$");
    expect(normalizeMathMarkdown("\\[\n\\frac{a}{b}\n\\]")).toBe("$$\n\\frac{a}{b}\n$$");
  });

  it("leaves code alone", () => {
    const source = "`$HOME` e `echo $5`\n```sh\necho $PATH $1\n```\n$x$";
    expect(normalizeMathMarkdown(source)).toBe(source);
  });

  it("does not pair dollars across a blank line", () => {
    expect(normalizeMathMarkdown("prezzo $5\n\nnuovo$")).toBe("prezzo \\$5\n\nnuovo\\$");
  });

  it("keeps escaped dollars", () => {
    expect(normalizeMathMarkdown("costa \\$5 e \\$6")).toBe("costa \\$5 e \\$6");
  });

  it("returns text without math unchanged", () => {
    const source = "Niente formule qui.";
    expect(normalizeMathMarkdown(source)).toBe(source);
  });
});

describe("texToUnicode", () => {
  it.each([
    ["1018.86\\text{hPa}", "1018.86\u202FhPa"],
    ["1018.86\\,\\text{hPa}", "1018.86\u2009hPa"],
    ["E=mc^2", "E=mc²"],
    ["\\frac{a+b}{2}", "(a+b)/2"],
    ["\\frac{1}{2}", "1/2"],
    ["x_{i}^{2} + y_1", "xᵢ² + y₁"],
    ["25^\\circ\\text{C}", "25°C"],
    ["\\alpha \\leq \\beta", "α ≤ β"],
    ["\\sqrt{x+1}", "√(x+1)"],
    ["\\mathbb{R}^n", "ℝⁿ"],
    ["\\sin x", "sin x"],
    ["10^{-3}", "10⁻³"],
    ["\\vec{v}", "v\u20D7"],
    ["\\left( a \\right)", "(a)"],
  ])("%s", (tex, text) => {
    expect(texToUnicode(tex)).toBe(text);
  });
});

describe("mathToPlainText", () => {
  it("replaces formulas and keeps prices", () => {
    expect(mathToPlainText("P = $1018.86\\text{hPa}$, costa $5 o $10")).toBe(
      "P = 1018.86\u202FhPa, costa $5 o $10",
    );
  });
});
