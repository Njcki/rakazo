import { ActionSheetIOS, Alert, Platform } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionsAreEmojiRow,
  dismissMessageActionSheet,
  presentMessageActionSheet,
  subscribeMessageActionSheet,
  type MessageActionSheetRequest,
} from "./message-action-sheet";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
  Alert: { alert: vi.fn() },
}));

function sheet() {
  const actions = ["Reply", "React", "Speak", "Copy"].map((text) => ({ text, onPress: vi.fn() }));
  presentMessageActionSheet({
    actions,
    title: "12:34",
    cancel: "Cancel",
    more: "More",
    colorScheme: "light",
  });
  return actions;
}

describe("native message action sheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dismissMessageActionSheet();
  });

  it("preserves every iOS action, timestamp, appearance and cancellation", () => {
    Platform.OS = "ios";
    const actions = sheet();
    const [options, select] = vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.calls[0]!;
    expect(options).toEqual({
      options: ["Reply", "React", "Speak", "Copy", "Cancel"],
      cancelButtonIndex: 4,
      title: "12:34",
      userInterfaceStyle: "light",
    });
    select(4);
    expect(actions.every((action) => action.onPress.mock.calls.length === 0)).toBe(true);
    for (let index = 0; index < actions.length; index++) {
      select(index);
      expect(actions[index]!.onPress).toHaveBeenCalledOnce();
    }
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("shows every Android action at once, with cancel separate and no Alert paging", () => {
    Platform.OS = "android";
    const seen: Array<MessageActionSheetRequest | null> = [];
    const unsubscribe = subscribeMessageActionSheet((request) => seen.push(request));
    const actions = sheet();
    expect(Alert.alert).not.toHaveBeenCalled();
    const request = seen.at(-1);
    expect(request?.title).toBe("12:34");
    expect(request?.cancel).toBe("Cancel");
    expect(request?.colorScheme).toBe("light");
    expect(request?.emojiRow).toBe(false);
    expect(request?.actions.map((action) => action.text)).toEqual([
      "Reply",
      "React",
      "Speak",
      "Copy",
    ]);
    expect(request?.actions.some((action) => action.text === "More")).toBe(false);
    for (const action of request?.actions ?? []) action.onPress();
    expect(actions.every((action) => action.onPress.mock.calls.length === 1)).toBe(true);
    dismissMessageActionSheet();
    expect(seen.at(-1)).toBeNull();
    unsubscribe();
  });

  it("flags a reaction picker as a single emoji row", () => {
    expect(actionsAreEmojiRow([{ text: "👍" }, { text: "❤️" }, { text: "😂" }])).toBe(true);
    expect(actionsAreEmojiRow([{ text: "Reply" }, { text: "👍" }])).toBe(false);
    Platform.OS = "android";
    let latest: MessageActionSheetRequest | null = null;
    const unsubscribe = subscribeMessageActionSheet((request) => {
      latest = request;
    });
    presentMessageActionSheet({
      actions: ["👍", "👎", "❤️", "😂", "🎉", "😮"].map((text) => ({ text, onPress: vi.fn() })),
      cancel: "Cancel",
      more: "More",
      colorScheme: "dark",
    });
    expect(latest?.emojiRow).toBe(true);
    expect(latest?.actions).toHaveLength(6);
    unsubscribe();
    dismissMessageActionSheet();
  });
});
