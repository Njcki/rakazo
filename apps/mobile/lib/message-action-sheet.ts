import { ActionSheetIOS, Platform } from "react-native";

export type MessageAction = { text: string; onPress: () => void };

export type MessageActionSheetRequest = {
  actions: MessageAction[];
  title?: string;
  cancel: string;
  colorScheme: "light" | "dark";
  /** Every action is a single emoji, so the sheet lays them out in one row. */
  emojiRow: boolean;
};

type Listener = (request: MessageActionSheetRequest | null) => void;

let current: MessageActionSheetRequest | null = null;
const listeners = new Set<Listener>();

function isSingleEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /[\p{L}\p{N}]/u.test(trimmed)) return false;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segments = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed),
    ];
    if (segments.length !== 1) return false;
  }
  return /^\p{Extended_Pictographic}/u.test(trimmed);
}

/** True when every action label is one emoji (reaction picker), not a word. */
export function actionsAreEmojiRow(actions: { text: string }[]): boolean {
  return actions.length > 0 && actions.every((action) => isSingleEmoji(action.text));
}

function emit() {
  for (const listener of listeners) listener(current);
}

export function currentMessageActionSheet(): MessageActionSheetRequest | null {
  return current;
}

/** Host in the root layout renders whatever this publishes. Immediate; no paging. */
export function subscribeMessageActionSheet(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissMessageActionSheet(): void {
  if (!current) return;
  current = null;
  emit();
}

export function presentMessageActionSheet({
  actions,
  title,
  cancel,
  colorScheme,
}: {
  actions: MessageAction[];
  title?: string;
  cancel: string;
  /** Kept for call sites. Android no longer paginates, so this is unused. */
  more: string;
  colorScheme: "light" | "dark";
}): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.text), cancel],
        cancelButtonIndex: actions.length,
        title,
        userInterfaceStyle: colorScheme,
      },
      (index) => actions[index]?.onPress(),
    );
    return;
  }

  current = {
    actions,
    title,
    cancel,
    colorScheme,
    emojiRow: actionsAreEmojiRow(actions),
  };
  emit();
}
