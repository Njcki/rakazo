import type { TableGestureGuard } from "@rakazo/chat-ui/native";
import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentProps, ComponentType } from "react";
import { Platform, View } from "react-native";

type GuardProps = ComponentProps<TableGestureGuard>;

function loadNativeGuard(): ComponentType<GuardProps> | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireNativeViewManager<GuardProps>("RakazoScrollGuard");
  } catch {
    return null;
  }
}

const NativeGuard = loadNativeGuard();

/** Gives a sideways swipe on a wide table to the table, not the chat list (Android). */
export const TableGestureGuardView: TableGestureGuard = ({ enabled, style, children }) =>
  NativeGuard ? (
    <NativeGuard enabled={enabled} style={style}>
      {children}
    </NativeGuard>
  ) : (
    <View style={style}>{children}</View>
  );
