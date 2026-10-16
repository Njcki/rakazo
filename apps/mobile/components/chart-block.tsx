import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { t } from "../lib/i18n";
import { PLOT_BUNDLE } from "../lib/plot-bundle.generated";

/**
 * Live chart for a `chart` message block (render_plot): the same validated
 * Observable Plot spec the web client draws, rendered in an offline WebView.
 * No network, no session: the spec and data are inlined into the document.
 */
function chartHtml(spec: unknown, data: unknown, width: number, height?: number) {
  const payload = JSON.stringify({ spec, data, width, height }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>html,body{margin:0;padding:0;background:#fff;color:#1a1a1a;font-family:system-ui,sans-serif}
#t{font-size:15px;font-weight:600;margin:0 0 4px}#l{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:#555;margin-bottom:6px}
#l span{display:flex;align-items:center;gap:5px}#l i{width:10px;height:10px;border-radius:3px;display:inline-block}
svg{max-width:100%;height:auto}#e{color:#b00020;font-size:13px}</style></head>
<body><div id="t"></div><div id="l"></div><div id="c"></div><div id="e"></div>
<script>${PLOT_BUNDLE}</script>
<script>(function(){var p=${payload};var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))};
try{var s=p.spec||{};var marks=Array.isArray(s.marks)?s.marks:[];
var parts=window.rakazoBuildPlot(s,p.data,document,{width:p.width,height:p.height});
if(parts.title)document.getElementById('t').textContent=parts.title;else document.getElementById('t').remove();
var l=document.getElementById('l');(parts.swatches||[]).forEach(function(w){var s=document.createElement('span');var i=document.createElement('i');i.style.background=w.color;s.appendChild(i);s.appendChild(document.createTextNode(w.label));l.appendChild(s)});
document.getElementById('c').appendChild(parts.plotted);
requestAnimationFrame(function(){post({height:Math.ceil(document.body.scrollHeight)})});
}catch(e){document.getElementById('e').textContent=String(e&&e.message||e);post({error:String(e&&e.message||e),height:40})}})();</script></body></html>`;
}

function ChartWebView({
  spec,
  data,
  width,
  height,
  onHeight,
  onError,
}: {
  spec: unknown;
  data: unknown;
  width: number;
  height?: number;
  onHeight?: (h: number) => void;
  onError?: (e: string) => void;
}) {
  const html = useMemo(() => chartHtml(spec, data, width, height), [spec, data, width, height]);
  return (
    <WebView
      source={{ html, baseUrl: "about:blank" }}
      originWhitelist={["about:*"]}
      style={{ flex: 1, backgroundColor: "white" }}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      cacheEnabled={false}
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={({ url }) => url.startsWith("about:")}
      onMessage={(event) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data) as { height?: number; error?: string };
          if (msg.error) onError?.(msg.error);
          if (msg.height) onHeight?.(msg.height);
        } catch {}
      }}
    />
  );
}

export function ChartBlockView({
  name,
  spec,
  data,
  maxWidth,
}: {
  name: string;
  spec: unknown;
  data: unknown;
  maxWidth: number;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(260);
  const [failed, setFailed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const width = Math.max(200, Math.floor(maxWidth));
  if (failed) {
    return (
      <Text style={{ fontSize: 15 }} selectable>
        [chart: {name}]
      </Text>
    );
  }
  const fullWidth = window.width - 24;
  const fullHeight = Math.max(240, window.height - insets.top - insets.bottom - 140);
  return (
    <View style={{ width, gap: 4 }}>
      <View style={[styles.frame, { height }]}>
        <ChartWebView
          spec={spec}
          data={data}
          width={width - 16}
          height={Math.round((width - 16) * 0.62)}
          onHeight={(h) => setHeight(Math.min(Math.max(h + 4, 80), 900))}
          onError={setFailed}
        />
        {/* Overlay so a tap opens the full-screen view instead of hitting the WebView. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="imagebutton"
          accessibilityLabel={name}
          onPress={() => setExpanded(true)}
        />
      </View>
      <Modal
        visible={expanded}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setExpanded(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "white",
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            paddingHorizontal: 12,
          }}
        >
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            <Pressable onPress={() => setExpanded(false)} hitSlop={12}>
              <Text style={styles.close}>{t("Close")}</Text>
            </Pressable>
          </View>
          {expanded ? (
            <ChartWebView spec={spec} data={data} width={fullWidth} height={fullHeight} />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: "hidden", backgroundColor: "white", padding: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { flex: 1, fontSize: 14, color: "#555" },
  close: { fontSize: 16, color: "#1a73e8", fontWeight: "600" },
});
