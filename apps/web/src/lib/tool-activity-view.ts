import type { MessageBlock } from "@rakazo/contracts";
import { isRetiredImportSetup, isToolActivityBlock } from "@rakazo/core";

/** Number of tool calls behind a steps block: the sum of each row's count. */
export function toolStepCount(steps: readonly { count: number }[]): number {
  return steps.reduce((total, step) => total + step.count, 0);
}

type StepsBlock = Extract<MessageBlock, { kind: "steps" }>;
type ToolStep = StepsBlock["steps"][number];

/**
 * Progress tools that already become their own chat bubbles (message_user).
 * Hiding them from the tool card avoids a redundant "Message user" row next to
 * the bubble that posted the same update.
 */
const HIDDEN_TOOL_STEP_LABELS = new Set(["Message user"]);

function isShownToolStep(step: ToolStep): boolean {
  return !HIDDEN_TOOL_STEP_LABELS.has(step.label);
}

/** Merge step rows the way live projection does: adjacent same label → count++. */
export function mergeToolSteps(steps: readonly ToolStep[]): ToolStep[] {
  const out: ToolStep[] = [];
  for (const step of steps) {
    if (!isShownToolStep(step)) continue;
    const last = out.at(-1);
    if (last && last.label === step.label) {
      out[out.length - 1] = { label: last.label, count: last.count + step.count };
    } else {
      out.push({ label: step.label, count: step.count });
    }
  }
  return out;
}

/**
 * One steps block for the whole message: every tool card in the turn collapses
 * into a single disclosure so "Done / N tools" is not interleaved with narration.
 */
export function coalesceStepsBlocks(blocks: readonly MessageBlock[]): StepsBlock | null {
  const stepBlocks = blocks.filter((block): block is StepsBlock => block.kind === "steps");
  if (stepBlocks.length === 0) return null;
  const steps = mergeToolSteps(stepBlocks.flatMap((block) => block.steps));
  if (steps.length === 0) return null;
  let durationMs: number | undefined;
  for (const block of stepBlocks) {
    if (block.durationMs === undefined) continue;
    durationMs =
      durationMs === undefined ? block.durationMs : Math.max(durationMs, block.durationMs);
  }
  return {
    kind: "steps",
    steps,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/** Narration / progress blocks only — tool cards are rendered separately below. */
export function narrationContentBlocks(blocks: readonly MessageBlock[]): MessageBlock[] {
  return blocks.filter((block) => block.kind === "text" || block.kind === "progress");
}

/**
 * Only a `steps` block becomes a card, and only when the preference is on.
 * A `progress` block marked `activity: true` never renders, in either mode.
 */
export function shouldRenderToolCard(block: MessageBlock, showToolActivity: boolean): boolean {
  return showToolActivity && block.kind === "steps";
}

/** Blocks that survive into a message render. */
export function renderableMessageBlocks(
  blocks: readonly MessageBlock[],
  showToolActivity: boolean,
): MessageBlock[] {
  return blocks.filter((block) => isShown(block, showToolActivity));
}

function isShown(block: MessageBlock, showToolActivity: boolean): boolean {
  if (isRetiredImportSetup(block)) return false;
  return !isToolActivityBlock(block) || shouldRenderToolCard(block, showToolActivity);
}

/**
 * True when a bot message's only visible blocks are tool cards, such as a live run that
 * has called tools but not written anything yet. Such a message renders as slim lines
 * between messages instead of inside a chat bubble.
 */
export function isToolOnlyNarration(
  blocks: readonly MessageBlock[],
  showToolActivity: boolean,
): boolean {
  const visible = renderableMessageBlocks(blocks, showToolActivity);
  return visible.length > 0 && visible.every((block) => block.kind === "steps");
}

/** True when a message still has at least one block to show under the preference. */
export function messageHasVisibleBlocks(
  blocks: readonly MessageBlock[],
  showToolActivity: boolean,
): boolean {
  return blocks.some((block) => isShown(block, showToolActivity));
}
