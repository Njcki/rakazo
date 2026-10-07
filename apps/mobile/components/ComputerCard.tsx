import { ChatMarkdown } from "@rakazo/chat-ui/native";
import type { MessageBlock } from "@rakazo/contracts";
import type { ViewProps } from "react-native";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens, useResolvedAppearance } from "../lib/native";

const THREAD_HORIZONTAL_PADDING = 20;
const MESSAGE_COLUMN_RATIO = 0.9;
const CARD_MAX_WIDTH = 340;

/** Width of a normal bot row: thread padding, then the 90% column cap. */
function computerCardWidth(windowWidth: number): number {
  const contentWidth = Math.max(0, windowWidth - THREAD_HORIZONTAL_PADDING * 2);
  return Math.min(CARD_MAX_WIDTH, Math.floor(contentWidth * MESSAGE_COLUMN_RATIO));
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 14,
  },
  buttonLabel: { fontSize: 14, fontWeight: "600" },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  header: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  state: { flexShrink: 1, fontSize: 13 },
  title: { fontSize: 15, fontWeight: "600" },
});

export function ComputerCard({
  block,
  onOpen,
  accessibilityActions,
  onAccessibilityAction,
}: {
  block: Extract<MessageBlock, { kind: "computer" }>;
  onOpen?: () => void;
  accessibilityActions?: ViewProps["accessibilityActions"];
  onAccessibilityAction?: ViewProps["onAccessibilityAction"];
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const { width: windowWidth } = useWindowDimensions();

  return (
    <View
      testID="computer-card"
      style={[
        styles.card,
        {
          width: computerCardWidth(windowWidth),
          borderColor: tokens.border,
          backgroundColor: tokens.card,
        },
      ]}
    >
      <View style={styles.header}>
        <Text
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          style={[styles.title, { color: tokens.foreground }]}
        >
          {t("Computer")}
        </Text>
        <Text
          style={[
            styles.state,
            { color: block.state === "Needs you" ? tokens.warning : tokens.success },
          ]}
        >
          {block.state}
        </Text>
      </View>
      {block.text ? (
        <ChatMarkdown palette={tokens} colorScheme={colorScheme}>
          {block.text}
        </ChatMarkdown>
      ) : null}
      {onOpen ? (
        <Pressable
          testID="computer-card-open"
          accessibilityRole="button"
          onPress={onOpen}
          style={[styles.button, { backgroundColor: native.fillPressed }]}
        >
          <Text style={[styles.buttonLabel, { color: native.label }]}>{t("Open computer")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
