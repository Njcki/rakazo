import katex from "katex";
import { KATEX_CSS, KATEX_FONTS } from "./katex-css.generated";

/**
 * A display formula (`$$…$$`, `\[…\]`) typeset by KaTeX. KaTeX turns the TeX into HTML here in
 * JS; a small offline WebView draws it with KaTeX's own stylesheet and fonts inlined (no network,
 * no files, no script but the height report). A formula wider than the bubble is scaled down,
 * and scrolls sideways only if it is still too wide. Invalid TeX reads as plain text.
 */

// Fonts nearly every formula uses; the rest are added only when the HTML asks for them.
const BASE_FONTS = [
  "KaTeX_Main-Regular",
  "KaTeX_Main-Bold",
  "KaTeX_Main-Italic",
  "KaTeX_Math-Italic",
  "KaTeX_AMS-Regular",
  "KaTeX_Size1-Regular",
  "KaTeX_Size2-Regular",
  "KaTeX_Size3-Regular",
  "KaTeX_Size4-Regular",
];
const OPTIONAL_FONTS: Array<[RegExp, string[]]> = [
  [/\bmathcal\b/, ["KaTeX_Caligraphic-Regular", "KaTeX_Caligraphic-Bold"]],
  [/\b(?:mathfrak|textfrak|mathboldfrak)\b/, ["KaTeX_Fraktur-Regular", "KaTeX_Fraktur-Bold"]],
  [
    /\b(?:mathsf|textsf|mathboldsf|textboldsf|mathitsf|textitsf)\b/,
    ["KaTeX_SansSerif-Regular", "KaTeX_SansSerif-Bold", "KaTeX_SansSerif-Italic"],
  ],
  [/\b(?:mathscr|textscr)\b/, ["KaTeX_Script-Regular"]],
  [/\b(?:mathtt|texttt)\b/, ["KaTeX_Typewriter-Regular"]],
  [/\b(?:boldsymbol|mathboldit)\b/, ["KaTeX_Math-BoldItalic"]],
  [/\b(?:textboldit|mathbfit)\b/, ["KaTeX_Main-BoldItalic"]],
];

export function renderDisplayMath(tex: string): string | null {
  try {
    return katex.renderToString(tex, {
      displayMode: true,
      throwOnError: true,
      strict: "ignore",
      trust: false,
      output: "html",
      maxExpand: 500,
    });
  } catch {
    return null;
  }
}

export function mathHtml(markup: string, color: string) {
  const fonts = [...BASE_FONTS];
  for (const [pattern, names] of OPTIONAL_FONTS) if (pattern.test(markup)) fonts.push(...names);
  const faces = fonts.map((name) => KATEX_FONTS[name] ?? "").join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:">
<style>${faces}${KATEX_CSS}
html,body{margin:0;padding:0;background:transparent;color:${color};-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
#m{display:flow-root;overflow-x:auto;overflow-y:hidden;padding:2px 0}#m .katex-display{margin:0;text-align:center}#m .katex{font-size:1.15em}</style></head>
<body><div id="m">${markup}</div>
<script>(function(){var m=document.getElementById('m');var last='';function post(){m.style.zoom='';var vw=document.documentElement.clientWidth;var w=m.scrollWidth;var z=1;if(vw>0&&w>vw)z=Math.max(0.55,vw/w);if(z<1)m.style.zoom=String(z);var h=Math.ceil(m.getBoundingClientRect().height);var s=m.scrollWidth>m.clientWidth+1;var msg=JSON.stringify({height:h,scroll:s});if(msg!==last){last=msg;window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(msg)}}
(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(post);window.addEventListener('resize',post);setTimeout(post,250)})();</script></body></html>`;
}
