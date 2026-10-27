import type { NativeStackNavigationOptions } from "expo-router";
import { Platform, Pressable, View } from "react-native";
import { iosAtLeast } from "../lib/native-controls";
import { NativeSymbol } from "./native-symbol";

/** One of a bot chat's actions in its "…" menu. */
export type ThreadHeaderAction = { text: string; destructive?: boolean; onPress: () => void };

/**
 * A chat header's right side: share + group settings in a group; share is also available
 * from the bot "…" menu. The chat route declares it when the screen is created, so the title
 * is centred against it from the first frame; the open chat then fills in the actions.
 */
export function threadHeaderRight({
  inGroup,
  readOnly,
  hasBot,
  t,
  color,
  rowStyle,
  onGroupSettings,
  onBotActions,
  onShare,
  menuActions,
  computerLabel,
}: {
  inGroup: boolean;
  readOnly: boolean;
  hasBot: boolean;
  t: (text: string) => string;
  color: string;
  rowStyle?: object;
  onGroupSettings: () => void;
  onBotActions: () => void;
  onShare?: () => void;
  menuActions: readonly ThreadHeaderAction[];
  /** The menu action that gets the computer icon. */
  computerLabel?: string;
}): NativeStackNavigationOptions {
  const shareButton =
    !readOnly && onShare
      ? {
          type: "button" as const,
          label: t("Share conversation"),
          accessibilityLabel: t("Share conversation"),
          icon: { type: "sfSymbol" as const, name: "square.and.arrow.up" },
          onPress: onShare,
        }
      : null;

  return {
    ...(Platform.OS === "ios" && !readOnly && (!inGroup || iosAtLeast(26))
      ? {
          unstable_headerRightItems: () => [
            ...(shareButton && inGroup ? [shareButton] : []),
            inGroup
              ? {
                  type: "button" as const,
                  label: t("Group settings"),
                  accessibilityLabel: t("Group settings"),
                  icon: { type: "sfSymbol" as const, name: "gearshape" },
                  onPress: onGroupSettings,
                }
              : {
                  type: "menu" as const,
                  label: t("Bot actions"),
                  accessibilityLabel: t("Bot actions"),
                  icon: { type: "sfSymbol" as const, name: "ellipsis" },
                  disabled: !hasBot,
                  menu: {
                    items: menuActions.map((action) => ({
                      type: "action" as const,
                      label: action.text,
                      destructive: action.destructive,
                      ...(action.text === computerLabel
                        ? { icon: { type: "sfSymbol" as const, name: "desktopcomputer" } }
                        : {}),
                      ...(action.text === t("Share conversation")
                        ? { icon: { type: "sfSymbol" as const, name: "square.and.arrow.up" } }
                        : {}),
                      onPress: action.onPress,
                    })),
                  },
                },
          ],
        }
      : {}),
    headerRight: () =>
      inGroup ? (
        <View style={[{ flexDirection: "row", alignItems: "center", gap: 14 }, rowStyle]}>
          {!readOnly && onShare ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Share conversation")}
              hitSlop={8}
              onPress={onShare}
            >
              <NativeSymbol
                ios="square.and.arrow.up"
                android="share-outline"
                size={21}
                color={color}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Group settings")}
            hitSlop={8}
            onPress={onGroupSettings}
          >
            <NativeSymbol ios="gearshape" android="settings-outline" size={21} color={color} />
          </Pressable>
        </View>
      ) : (
        <View style={rowStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Bot actions")}
            hitSlop={8}
            onPress={onBotActions}
          >
            <NativeSymbol ios="ellipsis" android="ellipsis-horizontal" size={21} color={color} />
          </Pressable>
        </View>
      ),
  };
}
