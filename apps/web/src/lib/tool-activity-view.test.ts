import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  coalesceStepsBlocks,
  isToolOnlyNarration,
  mergeToolSteps,
  messageHasVisibleBlocks,
  narrationContentBlocks,
  renderableMessageBlocks,
  shouldRenderToolCard,
  toolStepCount,
} from "./tool-activity-view";

const stepsBlock: MessageBlock = { kind: "steps", steps: [{ label: "Shell", count: 2 }] };
const stepsNoDuration: MessageBlock = { kind: "steps", steps: [{ label: "Shell", count: 2 }] };
const textBlock: MessageBlock = { kind: "text", text: "Here you go." };
const liveActivity: MessageBlock = { kind: "progress", text: "Using shell", activity: true };
const narration: MessageBlock = { kind: "progress", text: "Let me check that." };

describe("tool step count", () => {
  it("sums each row's count", () => {
    expect(toolStepCount([{ count: 1 }, { count: 3 }])).toBe(4);
    expect(toolStepCount([])).toBe(0);
  });
});

describe("tool card render decisions", () => {
  it("renders only steps blocks, and only when the preference is on", () => {
    expect(shouldRenderToolCard(stepsBlock, true)).toBe(true);
    expect(shouldRenderToolCard(stepsBlock, false)).toBe(false);
    expect(shouldRenderToolCard(textBlock, true)).toBe(false);
    expect(shouldRenderToolCard(liveActivity, true)).toBe(false);
  });

  it("keeps text order and drops hidden activity per preference", () => {
    const blocks = [textBlock, stepsBlock, liveActivity, narration];
    expect(renderableMessageBlocks(blocks, true)).toEqual([textBlock, stepsBlock, narration]);
    expect(renderableMessageBlocks(blocks, false)).toEqual([textBlock, narration]);
  });

  it("never surfaces a progress block marked as activity", () => {
    expect(messageHasVisibleBlocks([liveActivity], true)).toBe(false);
    expect(messageHasVisibleBlocks([liveActivity], false)).toBe(false);
  });

  it("keeps a steps-only message visible only when the preference is on", () => {
    expect(messageHasVisibleBlocks([stepsNoDuration], true)).toBe(true);
    expect(messageHasVisibleBlocks([stepsNoDuration], false)).toBe(false);
    expect(messageHasVisibleBlocks([textBlock], false)).toBe(true);
  });
});

describe("tool-only narration", () => {
  it("is true for a live run that has only called tools, and for a steps-only message", () => {
    expect(isToolOnlyNarration([liveActivity, stepsBlock], true)).toBe(true);
    expect(isToolOnlyNarration([stepsBlock], true)).toBe(true);
    expect(isToolOnlyNarration([stepsBlock, stepsNoDuration], true)).toBe(true);
  });

  it("is false once the bot has written something, or when tool cards are hidden", () => {
    expect(isToolOnlyNarration([stepsBlock, textBlock], true)).toBe(false);
    expect(isToolOnlyNarration([narration, liveActivity, stepsBlock], true)).toBe(false);
    expect(isToolOnlyNarration([liveActivity, stepsBlock], false)).toBe(false);
    expect(isToolOnlyNarration([liveActivity], true)).toBe(false);
  });
});

describe("coalesce steps below narration", () => {
  it("merges adjacent same-label rows and drops message_user rows", () => {
    expect(
      mergeToolSteps([
        { label: "Shell", count: 1 },
        { label: "Shell", count: 2 },
        { label: "Message user", count: 1 },
        { label: "Read file", count: 1 },
      ]),
    ).toEqual([
      { label: "Shell", count: 3 },
      { label: "Read file", count: 1 },
    ]);
  });

  it("collapses every steps block in a message into one card", () => {
    const blocks: MessageBlock[] = [
      { kind: "steps", steps: [{ label: "Shell", count: 1 }] },
      { kind: "text", text: "Sto esaminando i file." },
      {
        kind: "steps",
        steps: [
          { label: "Read file", count: 1 },
          { label: "Message user", count: 1 },
        ],
        durationMs: 4_000,
      },
      { kind: "progress", text: "Sto verificando la cartella." },
      { kind: "steps", steps: [{ label: "Shell", count: 1 }], durationMs: 12_000 },
    ];
    expect(coalesceStepsBlocks(blocks)).toEqual({
      kind: "steps",
      steps: [
        { label: "Shell", count: 1 },
        { label: "Read file", count: 1 },
        { label: "Shell", count: 1 },
      ],
      durationMs: 12_000,
    });
    expect(narrationContentBlocks(blocks)).toEqual([
      { kind: "text", text: "Sto esaminando i file." },
      { kind: "progress", text: "Sto verificando la cartella." },
    ]);
  });

  it("returns null when only hidden progress tools remain", () => {
    expect(
      coalesceStepsBlocks([
        { kind: "steps", steps: [{ label: "Message user", count: 3 }] },
        { kind: "text", text: "Aggiornamento." },
      ]),
    ).toBeNull();
  });
});

describe("a retired import checklist", () => {
  const item = { kind: "routine" as const, routineId: "routine-1", name: "morning" };
  const retired: MessageBlock[] = [
    // As Undo leaves it now, and as a marked one written before items were emptied.
    { kind: "import_setup", items: [], undone: true },
    { kind: "import_setup", items: [item], undone: true },
    { kind: "import_setup", items: [] },
  ];

  it("gives its message no row, in either tool-activity mode", () => {
    for (const block of retired) {
      for (const showToolActivity of [true, false]) {
        expect(messageHasVisibleBlocks([block], showToolActivity)).toBe(false);
        expect(renderableMessageBlocks([block], showToolActivity)).toEqual([]);
      }
    }
  });

  it("still shows a live checklist and anything beside a retired one", () => {
    const live: MessageBlock = { kind: "import_setup", items: [item] };
    expect(messageHasVisibleBlocks([live], false)).toBe(true);
    expect(renderableMessageBlocks([retired[0]!, textBlock], false)).toEqual([textBlock]);
  });
});
