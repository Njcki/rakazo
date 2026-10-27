import { texToUnicode } from "@rakazo/chat-ui/math";
import type { ColorTokens } from "@rakazo/ui-tokens";
import { memo, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { mathHtml, renderDisplayMath } from "../lib/math-html";

export const MathBlockView = memo(function MathBlockView({
  tex,
  palette,
}: {
  tex: string;
  palette: ColorTokens;
}) {
  const markup = useMemo(() => renderDisplayMath(tex), [tex]);
  const html = useMemo(
    () => (markup ? mathHtml(markup, palette.foreground) : null),
    [markup, palette.foreground],
  );
  const [size, setSize] = useState<{ height: number; scroll: boolean }>({
    height: 40,
    scroll: false,
  });
  const text = useMemo(() => texToUnicode(tex), [tex]);
  if (!html) {
    return (
      <Text style={[styles.fallback, { color: palette.foreground }]} selectable>
        {text}
      </Text>
    );
  }
  return (
    <View
      style={[styles.frame, { height: size.height }]}
      accessible
      accessibilityLabel={text}
      // A formula that fits needs no touch: long-press and scrolling keep working on the message.
      pointerEvents={size.scroll ? "auto" : "none"}
    >
      <WebView
        source={{ html, baseUrl: "about:blank" }}
        originWhitelist={["about:*"]}
        style={styles.web}
        containerStyle={styles.web}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        cacheEnabled={false}
        scrollEnabled={size.scroll}
        nestedScrollEnabled={size.scroll}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={size.scroll}
        setSupportMultipleWindows={false}
        textZoom={100}
        onShouldStartLoadWithRequest={({ url }) => url.startsWith("about:")}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data) as { height?: number; scroll?: boolean };
            if (!msg.height) return;
            const height = Math.min(Math.max(msg.height + 2, 24), 600);
            const scroll = Boolean(msg.scroll);
            setSize((current) =>
              current.height === height && current.scroll === scroll ? current : { height, scroll },
            );
          } catch {}
        }}
      />
    </View>
  );
});

export function MathBlockRenderer({ tex, palette }: { tex: string; palette: ColorTokens }) {
  return <MathBlockView tex={tex} palette={palette} />;
}

const styles = StyleSheet.create({
  frame: { width: "100%", overflow: "hidden" },
  web: { flex: 1, backgroundColor: "transparent" },
  fallback: { width: "100%", textAlign: "center", fontSize: 16.5, lineHeight: 24 },
});
