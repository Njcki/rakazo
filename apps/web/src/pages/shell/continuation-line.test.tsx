// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ComponentProps } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The macro compiles away in the app build; here `t` looks the template up positionally in the
 * real catalog of `locale` (English source when "en"), so the Italian strings are tested as shipped.
 */
const lingui = vi.hoisted(() => ({ locale: "en", catalog: new Map<string, string>() }));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const key = strings.reduce(
        (out, part, i) => (i === 0 ? part : `${out}{${i - 1}}${part}`),
        "",
      );
      const message = lingui.locale === "en" ? key : (lingui.catalog.get(key) ?? key);
      return message.replace(/\{(\d+)\}/g, (_, i: string) => String(values[Number(i)]));
    },
  }),
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
}));

import { ContinuationLine } from "./continuation-line";

/** Entries of this component, keyed by their template with positional placeholders. */
function loadCatalog(locale: string): Map<string, string> {
  const po = readFileSync(resolve(__dirname, `../../locales/${locale}/messages.po`), "utf8");
  const map = new Map<string, string>();
  for (const block of po.split("\n\n")) {
    if (!block.includes("src/pages/shell/continuation-line.tsx")) continue;
    const id = JSON.parse(block.match(/^msgid (".*")$/m)?.[1] ?? '""') as string;
    const str = JSON.parse(block.match(/^msgstr (".*")$/m)?.[1] ?? '""') as string;
    const names = [...id.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const positional = (text: string) =>
      text.replace(/\{(\w+)\}/g, (whole, name: string) =>
        names.includes(name) ? `{${names.indexOf(name)}}` : whole,
      );
    map.set(positional(id), positional(str));
  }
  return map;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  lingui.locale = "en";
});

type Continuation = ComponentProps<typeof ContinuationLine>["continuation"];

function render(continuation: Continuation) {
  act(() => root.render(<ContinuationLine continuation={continuation} />));
  const span = container.querySelector('[data-testid="continuation-line"] span:nth-of-type(2)');
  return { text: span?.textContent ?? "", hint: span?.getAttribute("title") ?? "" };
}

describe("ContinuationLine", () => {
  it("says what it is and what the percent refers to (English source)", () => {
    expect(
      render({
        state: "scheduled",
        index: 3,
        max: 50,
        percent: 13,
        measure: { value: 120, target: 900, unit: "items" },
      }),
    ).toEqual({
      text: "Continuing on its own · round 3 of max 50 · 120 items of 900 (13%)",
      hint: "The bot keeps working on its own until the goal is reached; the percentage is measured by the system",
    });
    expect(render({ state: "scheduled", index: 2, max: 50, percent: 40 }).text).toBe(
      "Continuing on its own · round 2 of max 50 · 40% (bot estimate)",
    );
    expect(render({ state: "scheduled", index: 2, max: 50 })).toEqual({
      text: "Continuing on its own · round 2 of max 50",
      hint: "The bot keeps working on its own until the goal is reached",
    });
    expect(render({ state: "limit", index: 51, max: 50 }).hint).toBe("");
  });

  it("is translated in Italian, with the bot's lower estimate shown next to the measure", () => {
    lingui.locale = "it";
    lingui.catalog = loadCatalog("it");
    expect(
      render({
        state: "scheduled",
        index: 3,
        max: 50,
        percent: 10,
        measure: { value: 45, target: 300, unit: "file" },
      }).text,
    ).toBe("Prosegue da solo · giro 3 di max 50 · 45 file su 300 (15%) · stima del bot 10%");
    expect(
      render({
        state: "scheduled",
        index: 3,
        max: 50,
        percent: 50,
        measure: { value: 5, target: 10 },
      }),
    ).toEqual({
      text: "Prosegue da solo · giro 3 di max 50 · 5 su 10 (50%)",
      hint: "Il bot continua il lavoro in automatico finché il traguardo non è raggiunto; la percentuale è misurata dal sistema",
    });
    expect(render({ state: "scheduled", index: 4, max: 50, percent: 30 })).toEqual({
      text: "Prosegue da solo · giro 4 di max 50 · 30% (stima del bot)",
      hint: "Il bot continua il lavoro in automatico finché il traguardo non è raggiunto; la percentuale è stimata dal bot",
    });
    expect(render({ state: "scheduled", index: 1, max: 50 }).text).toBe(
      "Prosegue da solo · giro 1 di max 50",
    );
  });
});
