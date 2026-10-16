import type { AppearancePreference } from "@rakazo/ui-tokens";
import { blackTokens, darkTokens, lightTokens } from "@rakazo/ui-tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMobileTokens } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

type Palette = { background: string; card: string; border: string; foreground: string; accent: string };

const pal = (t: typeof lightTokens | typeof darkTokens | typeof blackTokens): Palette => ({
  background: t.background,
  card: t.card,
  border: t.border,
  foreground: t.mutedForeground,
  accent: t.ring,
});

function Swatch({ palette }: { palette: Palette }) {
  return (
    <View style={[styles.swatchHalf, { backgroundColor: palette.background }]}>
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={[styles.line, { backgroundColor: palette.foreground, width: "70%" }]} />
        <View style={[styles.line, { backgroundColor: palette.foreground, width: "45%", opacity: 0.6 }]} />
      </View>
      <View style={[styles.accent, { backgroundColor: palette.accent }]} />
    </View>
  );
}

export function AppearancePicker({
  value,
  onChange,
  labels,
  accessibilityLabel,
}: {
  value: AppearancePreference;
  onChange: (value: AppearancePreference) => void;
  labels: Record<AppearancePreference, string>;
  accessibilityLabel?: string;
}) {
  const tokens = useMobileTokens();
  const options: AppearancePreference[] = ["system", "light", "dark", "black"];
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="radiogroup" style={styles.grid}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={labels[option]}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: tokens.card,
                borderColor: selected ? tokens.ring : tokens.border,
                borderWidth: selected ? 2 : StyleSheet.hairlineWidth * 2,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={[styles.swatch, { borderColor: tokens.border }]}>
              {option === "system" ? (
                <>
                  <Swatch palette={pal(lightTokens)} />
                  <Swatch palette={pal(darkTokens)} />
                </>
              ) : (
                <Swatch palette={pal(option === "light" ? lightTokens : option === "dark" ? darkTokens : blackTokens)} />
              )}
            </View>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: tokens.foreground }]} numberOfLines={1}>
                {labels[option]}
              </Text>
              {selected ? (
                <NativeSymbol ios="checkmark.circle.fill" android="checkmark-circle" size={18} color={tokens.ring} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  tile: { width: "48%", borderRadius: 14, padding: 8, gap: 8 },
  swatch: { height: 72, borderRadius: 10, overflow: "hidden", flexDirection: "row", borderWidth: StyleSheet.hairlineWidth },
  swatchHalf: { flex: 1, padding: 8, justifyContent: "space-between" },
  card: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, padding: 6, gap: 4 },
  line: { height: 4, borderRadius: 2 },
  accent: { height: 3, width: "40%", borderRadius: 2 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, minHeight: 22 },
  label: { fontSize: 15, fontWeight: "600" },
});
