import { tokensForAppearance } from "@rakazo/ui-tokens";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  dismissMessageActionSheet,
  type MessageAction,
  type MessageActionSheetRequest,
  subscribeMessageActionSheet,
} from "../lib/message-action-sheet";

/**
 * One Android bottom sheet for every presentMessageActionSheet caller.
 * iOS keeps ActionSheetIOS and this host renders nothing there.
 */
export function MessageActionSheetHost() {
  const [request, setRequest] = useState<MessageActionSheetRequest | null>(null);
  const insets = useSafeAreaInsets();
  const translate = useRef(new Animated.Value(420)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeMessageActionSheet(setRequest), []);

  useEffect(() => {
    if (!request) return;
    translate.setValue(420);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translate, {
        toValue: 0,
        useNativeDriver: true,
        damping: 24,
        stiffness: 280,
        mass: 0.7,
      }),
    ]).start();
  }, [request, fade, translate]);

  useEffect(() => {
    if (Platform.OS !== "android" || !request) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      dismissMessageActionSheet();
      return true;
    });
    return () => sub.remove();
  }, [request]);

  if (Platform.OS !== "android" || !request) return null;

  const tokens = tokensForAppearance(request.colorScheme);
  const maxList = Math.round(Dimensions.get("window").height * 0.62);

  function choose(action: MessageAction) {
    // Dismiss first so a follow-up sheet (reaction picker) replaces this one
    // instead of being cleared by a late dismiss.
    dismissMessageActionSheet();
    action.onPress();
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissMessageActionSheet}
    >
      <View style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: tokens.overlay, opacity: fade }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismissMessageActionSheet}
          accessibilityLabel={request.cancel}
        />
        <Animated.View
          style={[
            styles.dock,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              transform: [{ translateY: translate }],
            },
          ]}
        >
          <View style={[styles.sheet, { backgroundColor: tokens.popover }]}>
            {request.title ? (
              <Text style={[styles.title, { color: tokens.mutedForeground }]} numberOfLines={2}>
                {request.title}
              </Text>
            ) : (
              <View style={styles.titleSpacer} />
            )}
            {request.emojiRow ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.emojiRow}
              >
                {request.actions.map((action) => (
                  <Pressable
                    key={action.text}
                    onPress={() => choose(action)}
                    accessibilityRole="button"
                    accessibilityLabel={action.text}
                    style={({ pressed }) => [
                      styles.emojiHit,
                      { backgroundColor: pressed ? tokens.accent : "transparent" },
                    ]}
                  >
                    <Text style={styles.emoji}>{action.text}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <ScrollView style={{ maxHeight: maxList }} bounces={false}>
                {request.actions.map((action, index) => (
                  <Pressable
                    key={`${action.text}-${index}`}
                    onPress={() => choose(action)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: tokens.border,
                      },
                      { backgroundColor: pressed ? tokens.accent : "transparent" },
                    ]}
                  >
                    {action.icon ? (
                      <View
                        style={[
                          styles.iconWrap,
                          {
                            backgroundColor: action.destructive
                              ? "rgba(239,68,68,0.14)"
                              : tokens.accent,
                          },
                        ]}
                      >
                        <Ionicons
                          name={action.icon as never}
                          size={19}
                          color={action.destructive ? tokens.destructive : tokens.popoverForeground}
                        />
                      </View>
                    ) : null}
                    <Text
                      style={[
                        styles.rowLabel,
                        {
                          color: action.destructive ? tokens.destructive : tokens.popoverForeground,
                        },
                      ]}
                    >
                      {action.text}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.sheetPad} />
          </View>
          <Pressable
            onPress={dismissMessageActionSheet}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancel,
              {
                backgroundColor: pressed ? tokens.accent : tokens.popover,
              },
            ]}
          >
            <Text style={[styles.cancelLabel, { color: tokens.popoverForeground }]}>
              {request.cancel}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  dock: { paddingHorizontal: 10, gap: 8 },
  sheet: {
    borderRadius: 28,
    overflow: "hidden",
  },
  title: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 16,
    paddingBottom: 6,
    paddingHorizontal: 20,
  },
  titleSpacer: { height: 10 },
  row: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 16.5, fontWeight: "500", flex: 1 },
  emojiRow: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 6,
    gap: 4,
  },
  emojiHit: {
    minWidth: 52,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  emoji: { fontSize: 30 },
  sheetPad: { height: 8 },
  cancel: {
    minHeight: 52,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  cancelLabel: { fontSize: 17, fontWeight: "600" },
});
