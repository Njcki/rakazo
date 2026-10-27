import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import Ionicons from "@react-native-vector-icons/ionicons";
import { t } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { PLOT_BUNDLE } from "../lib/plot-bundle.generated";

/**
 * Live chart for a `chart` message block (render_plot): the same validated
 * Observable Plot spec the web client draws, rendered in an offline WebView.
 * No network, no session: the spec and data are inlined into the document.
 */
export type ChartTheme = { bg: string; fg: string; muted: string; border: string };

export function chartHtml(
  spec: unknown,
  data: unknown,
  width: number,
  height: number | undefined,
  theme: ChartTheme,
) {
  const payload = JSON.stringify({ spec, data, width, height }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>html,body{margin:0;padding:0;background:${theme.bg};color:${theme.fg};font-family:system-ui,sans-serif;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
#c{touch-action:pan-y}#c svg{overflow:visible;--plot-background:${theme.bg} !important}
#t{font-size:15px;font-weight:600;margin:0 0 4px}#l{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:${theme.muted};margin-bottom:6px}
#l span{display:flex;align-items:center;gap:5px}#l i{width:10px;height:10px;border-radius:3px;display:inline-block}
svg{max-width:100%;height:auto}#e{color:#b00020;font-size:13px}</style></head>
<body><div id="t"></div><div id="l"></div><div id="c"></div><div id="e"></div>
<script>${PLOT_BUNDLE}</script>
<script>(function(){var p=${payload};var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))};
try{var s=p.spec||{};var marks=Array.isArray(s.marks)?s.marks:[];var hasTip=marks.some(function(m){return m&&m.options&&('tip' in m.options)});if(!hasTip&&marks.length){s=Object.assign({},s,{marks:marks.map(function(m,i){return i===0?Object.assign({},m,{options:Object.assign({},m.options||{},{tip:true})}):m})})}
var parts=window.rakazoBuildPlot(s,p.data,document,{width:p.width,height:p.height});
if(parts.title)document.getElementById('t').textContent=parts.title;else document.getElementById('t').remove();
var l=document.getElementById('l');(parts.swatches||[]).forEach(function(w){var s=document.createElement('span');var i=document.createElement('i');i.style.background=w.color;s.appendChild(i);s.appendChild(document.createTextNode(w.label));l.appendChild(s)});
var c=document.getElementById('c');c.appendChild(parts.plotted);var svg=c.querySelector('svg');var fire=function(type,e){var o={bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY,pointerId:1,pointerType:'mouse',isPrimary:true};svg.dispatchEvent(new PointerEvent(type,o))};var sx=0,sy=0;document.addEventListener('pointerdown',function(e){if(e.pointerType==='mouse'||!e.isTrusted)return;sx=e.clientX;sy=e.clientY},true);document.addEventListener('pointerup',function(e){if(e.pointerType==='mouse'||!e.isTrusted)return;if(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10)return;var r=svg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){fire('pointerleave',e);return}fire('pointerenter',e);fire('pointermove',e)},true);['pointermove','pointerenter','pointerleave','pointerdown'].forEach(function(t){svg.addEventListener(t,function(e){if(e.isTrusted&&e.pointerType!=='mouse')e.stopImmediatePropagation()},true)});
requestAnimationFrame(function(){post({height:Math.ceil(document.body.scrollHeight)})});
}catch(e){document.getElementById('e').textContent=String(e&&e.message||e);post({error:String(e&&e.message||e),height:40})}})();</script></body></html>`;
}

function ChartWebView({
  spec,
  data,
  width,
  height,
  theme,
  onHeight,
  onError,
}: {
  theme: ChartTheme;
  spec: unknown;
  data: unknown;
  width: number;
  height?: number;
  onHeight?: (h: number) => void;
  onError?: (e: string) => void;
}) {
  const html = useMemo(
    () => chartHtml(spec, data, width, height, theme),
    [spec, data, width, height, theme],
  );
  return (
    <WebView
      source={{ html, baseUrl: "about:blank" }}
      originWhitelist={["about:*"]}
      style={{ flex: 1, backgroundColor: theme.bg }}
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
  const tokens = useMobileTokens();
  const theme = useMemo<ChartTheme>(
    () => ({
      bg: tokens.muted,
      fg: tokens.foreground,
      muted: tokens.mutedForeground,
      border: tokens.border,
    }),
    [tokens.muted, tokens.foreground, tokens.mutedForeground, tokens.border],
  );
  const fullTheme = useMemo<ChartTheme>(() => ({ ...theme, bg: tokens.background }), [theme, tokens.background]);
  const [height, setHeight] = useState(260);
  const [failed, setFailed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const width = Math.max(200, Math.floor(maxWidth));
  if (failed) {
    return (
      <Text style={{ fontSize: 15, color: tokens.foreground }} selectable>
        [chart: {name}]
      </Text>
    );
  }
  const fullWidth = window.width - 24;
  const fullHeight = Math.max(240, window.height - insets.top - insets.bottom - 140);
  return (
    <View style={{ width, gap: 4 }}>
      <View style={[styles.frame, { height, backgroundColor: theme.bg }]}>
        <ChartWebView
          spec={spec}
          data={data}
          width={width - 16}
          theme={theme}
          height={Math.round((width - 16) * 0.62)}
          onHeight={(h) => setHeight(Math.min(Math.max(h + 4, 80), 900))}
          onError={setFailed}
        />
        <Pressable
          style={[styles.expand, { backgroundColor: tokens.background, borderColor: tokens.border }]}
          accessibilityRole="button"
          accessibilityLabel={t("Expand")}
          hitSlop={8}
          onPress={() => setExpanded(true)}
        >
          <Ionicons name="expand-outline" size={16} color={tokens.foreground} />
        </Pressable>
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
            backgroundColor: tokens.background,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            paddingHorizontal: 12,
          }}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: tokens.mutedForeground }]} numberOfLines={1}>
              {name}
            </Text>
            <Pressable onPress={() => setExpanded(false)} hitSlop={12}>
              <Text style={[styles.close, { color: tokens.primary ?? "#1a73e8" }]}>{t("Close")}</Text>
            </Pressable>
          </View>
          {expanded ? (
            <ChartWebView spec={spec} data={data} width={fullWidth} height={fullHeight} theme={fullTheme} />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: "hidden", padding: 8 },
  expand: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.9,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { flex: 1, fontSize: 14, color: "#555" },
  close: { fontSize: 16, color: "#1a73e8", fontWeight: "600" },
});
