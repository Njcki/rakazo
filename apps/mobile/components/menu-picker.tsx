import { MenuView } from "@expo/ui/community/menu";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
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
