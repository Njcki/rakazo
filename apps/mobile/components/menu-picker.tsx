import { MenuView } from "@expo/ui/community/menu";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toNativeColorScheme } from "../lib/appearance";
import { native, useResolvedAppearance, useThemedStyles } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

export type MenuPickerChoice = {
  key: string;
  label: string;
  /** Nested submenu (e.g. provider → models). Leaf rows carry the selectable key. */
  children?: readonly MenuPickerChoice[];
};

function findChoiceLabel(
  choices: readonly MenuPickerChoice[],
  value: string,
  parentLabel?: string,
): string | undefined {
  for (const choice of choices) {
    if (choice.children?.length) {
      const nested = findChoiceLabel(choice.children, value, choice.label);
      if (nested !== undefined) return nested;
    } else if (choice.key === value) {
      return parentLabel ? `${parentLabel} · ${choice.label}` : choice.label;
    }
  }
  return undefined;
}

function firstLeafLabel(choices: readonly MenuPickerChoice[]): string {
  for (const choice of choices) {
    if (choice.children?.length) {
      const nested = firstLeafLabel(choice.children);
      if (nested) return nested;
    } else {
      return choice.label;
    }
  }
  return "";
}

function toMenuActions(choices: readonly MenuPickerChoice[], value: string) {
  return choices.map((choice) => {
    if (choice.children?.length) {
      return {
        id: `group:${choice.key}`,
        title: choice.label,
        subactions: toMenuActions(choice.children, value),
      };
    }
    return {
      // MenuView reports an empty id as the title, so prefix keys to keep "" distinct.
      id: `choice:${choice.key}`,
      title: choice.label,
      state: (choice.key === value ? "on" : "off") as "on" | "off",
    };
  });
}

/** Native choice menu shared by rows with different layouts. Supports nested groups via children. */
export function MenuPickerMenu({
  label,
  choices,
  value,
  onChange,
  children,
}: {
  label: string;
  choices: readonly MenuPickerChoice[];
  value: string;
  onChange: (key: string) => void;
  children: ReactNode;
}) {
  const colorScheme = toNativeColorScheme(useResolvedAppearance());
  // Android's native popup cannot be inset: long lists grow under the status bar.
  // Above a small threshold use a safe-area-aware scrollable sheet instead.
  if (Platform.OS === "android" && countLeaves(choices) > ANDROID_MENU_MAX_LEAVES) {
    return (
      <SafeListPicker choices={choices} label={label} onChange={onChange} value={value}>
        {children}
      </SafeListPicker>
    );
  }
  return (
    <MenuView
      actions={toMenuActions(choices, value)}
      colorScheme={colorScheme}
      onPressAction={(event) => {
        const id = event.nativeEvent.event;
        if (id.startsWith("choice:")) onChange(id.slice("choice:".length));
      }}
      title={label}
    >
      {children}
    </MenuView>
  );
}

/** A list row that opens a native menu of choices; the current one carries the system checkmark. */
export function MenuPicker({
  label,
  choices,
  value,
  onChange,
  divider = false,
}: {
  label: string;
  choices: readonly MenuPickerChoice[];
  value: string;
  onChange: (key: string) => void;
  divider?: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const current = findChoiceLabel(choices, value) ?? firstLeafLabel(choices);
  return (
    <MenuPickerMenu choices={choices} label={label} onChange={onChange} value={value}>
      <View
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityValue={{ text: current }}
        accessible
        style={[styles.row, divider && styles.divider]}
      >
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={styles.value}>
          {current}
        </Text>
        <NativeSymbol
          android="chevron-expand"
          color={native.tertiaryLabel}
          ios="chevron.up.chevron.down"
          size={13}
        />
      </View>
    </MenuPickerMenu>
  );
}

function createStyles() {
  return StyleSheet.create({
    row: {
      minHeight: 52,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    sheet: {
      flex: 1,
      backgroundColor: native.page,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: native.separator,
    },
    sheetRow: {
      minHeight: 48,
      paddingRight: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: native.separator,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: native.separator,
    },
    label: {
      color: native.label,
      fontSize: 16,
    },
    value: {
      flex: 1,
      color: native.secondaryLabel,
      textAlign: "right",
      fontSize: 16,
    },
  });
}

const ANDROID_MENU_MAX_LEAVES = 12;

function countLeaves(choices: readonly MenuPickerChoice[]): number {
  let total = 0;
  for (const choice of choices) {
    total += choice.children?.length ? countLeaves(choice.children) : 1;
  }
  return total;
}

function groupContains(choice: MenuPickerChoice, value: string): boolean {
  return (choice.children ?? []).some((child) =>
    child.children?.length ? groupContains(child, value) : child.key === value,
  );
}

/** Android fallback: full-screen sheet that respects status/navigation bar insets. */
function SafeListPicker({
  label,
  choices,
  value,
  onChange,
  children,
}: {
  label: string;
  choices: readonly MenuPickerChoice[];
  value: string;
  onChange: (key: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, StatusBar.currentHeight ?? 0);
  const styles = useThemedStyles(createStyles);

  function openSheet() {
    setExpanded(
      new Set(choices.filter((c) => c.children?.length && groupContains(c, value)).map((c) => c.key)),
    );
    setOpen(true);
  }

  function renderChoices(list: readonly MenuPickerChoice[], depth: number): ReactNode {
    return list.map((choice) => {
      if (choice.children?.length) {
        const isOpen = expanded.has(choice.key);
        return (
          <View key={`group:${choice.key}`}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              onPress={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(choice.key)) next.delete(choice.key);
                  else next.add(choice.key);
                  return next;
                })
              }
              style={[styles.sheetRow, { paddingLeft: 16 + depth * 16 }]}
            >
              <Text style={[styles.label, { flex: 1, fontWeight: "600" }]}>{choice.label}</Text>
              <Text style={styles.value}>{`${choice.children.length} ${isOpen ? "▴" : "▾"}`}</Text>
            </Pressable>
            {/* Only expanded groups render rows, so huge providers stay cheap. */}
            {isOpen ? renderChoices(choice.children, depth + 1) : null}
          </View>
        );
      }
      const selected = choice.key === value;
      return (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          key={`choice:${choice.key}`}
          onPress={() => {
            setOpen(false);
            onChange(choice.key);
          }}
          style={[styles.sheetRow, { paddingLeft: 16 + depth * 16 }]}
        >
          <Text numberOfLines={2} style={[styles.label, { flex: 1 }]}>
            {choice.label}
          </Text>
          {selected ? <Text style={styles.label}>✓</Text> : null}
        </Pressable>
      );
    });
  }

  return (
    <>
      <Pressable accessibilityRole="button" onPress={openSheet}>
        {children}
      </Pressable>
      <Modal
        animationType="slide"
        navigationBarTranslucent
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent={false}
        visible={open}
      >
        <View style={[styles.sheet, { paddingTop: top, paddingBottom: insets.bottom }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.label, { flex: 1, fontWeight: "700", fontSize: 18 }]}>
              {label}
            </Text>
            <Pressable accessibilityRole="button" hitSlop={12} onPress={() => setOpen(false)}>
              <Text style={[styles.label, { fontSize: 22 }]}>✕</Text>
            </Pressable>
          </View>
          <ScrollView>{renderChoices(choices, 0)}</ScrollView>
        </View>
      </Modal>
    </>
  );
}
