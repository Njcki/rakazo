/**
 * TeX math in chat Markdown: `$…$`, `$$…$$`, `\(…\)` and `\[…\]`.
 *
 * Models often answer with LaTeX ("$1018.86\text{hPa}$"). Both renderers first rewrite a
 * message into one canonical form, so the web (remark-math) and the native parser agree on
 * what counts as math:
 *
 * - `\(…\)` becomes `$…$` and `\[…\]` becomes `$$…$$`.
 * - A `$…$` span follows the Pandoc rules, so prices stay text: the opening `$` is not
 *   followed by whitespace, the closing `$` is not preceded by whitespace nor followed by a
 *   digit, and a span never crosses a blank line. "costa $5 o $10" has no math.
 * - Any other `$` is escaped (`\$`), so remark-math cannot pair it up.
 * - Display math alone on its line becomes a `$$` block on lines of its own.
 * - Fenced code and inline code spans are left untouched.
 */

export type MathSpan = {
  tex: string;
  /** `$$…$$` or `\[…\]`. */
  display: boolean;
  /** Display math that stands alone on its line(s): drawn as a block. */
  block: boolean;
};

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MAY_HAVE_MATH = /\$|\\[([]/;
const WHITESPACE = /\s/;
const DIGIT = /[0-9]/;

function hasBlankLine(text: string) {
  return /\n[ \t]*\n/.test(text);
}

/** The index of the next `marker` at or after `from` that is not backslash-escaped. */
function nextUnescaped(text: string, marker: string, from: number) {
  let at = text.indexOf(marker, from);
  while (at > 0 && text[at - 1] === "\\") at = text.indexOf(marker, at + 1);
  return at;
}

function transformText(
  text: string,
  render: (span: MathSpan) => string,
  loneDollar: string,
): string {
  let out = "";
  let i = 0;
  const n = text.length;
  const emit = (tex: string, display: boolean, start: number, end: number) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    const before = text.slice(lineStart, start);
    const after = text.slice(end, lineEnd < 0 ? n : lineEnd);
    const block = display && /^ {0,3}$/.test(before) && after.trim() === "";
    return render({ tex, display, block });
  };
  while (i < n) {
    const char = text[i];
    if (char === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const fence = "`".repeat(run);
      let close = text.indexOf(fence, i + run);
      while (close >= 0 && text[close + run] === "`") {
        let skip = close;
        while (text[skip] === "`") skip++;
        close = text.indexOf(fence, skip);
      }
      if (close < 0) {
        out += fence;
        i += run;
      } else {
        out += text.slice(i, close + run);
        i = close + run;
      }
      continue;
    }
    if (char === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        const close = text.indexOf(next === "(" ? "\\)" : "\\]", i + 2);
        const inner = close < 0 ? "" : text.slice(i + 2, close);
        if (close >= 0 && inner.trim() && !hasBlankLine(inner)) {
          out += emit(inner.trim(), next === "[", i, close + 2);
          i = close + 2;
          continue;
        }
      }
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (char === "$") {
      if (text[i + 1] === "$") {
        const close = nextUnescaped(text, "$$", i + 2);
        const inner = close < 0 ? "" : text.slice(i + 2, close);
        if (close >= 0 && inner.trim() && !hasBlankLine(inner)) {
          out += emit(inner.trim(), true, i, close + 2);
          i = close + 2;
          continue;
        }
        out += loneDollar + loneDollar;
        i += 2;
        continue;
      }
      const first = text[i + 1];
      if (first !== undefined && !WHITESPACE.test(first)) {
        const blank = /\n[ \t]*\n/g;
        blank.lastIndex = i;
        const paragraphEnd = blank.exec(text)?.index ?? n;
        let close = text.indexOf("$", i + 1);
        while (close >= 0 && close < paragraphEnd) {
          const left = text[close - 1] ?? "";
          const right = text[close + 1] ?? "";
          if (left !== "\\" && !WHITESPACE.test(left) && !DIGIT.test(right) && right !== "$") break;
          close = text.indexOf("$", close + 1);
        }
        if (close >= 0 && close < paragraphEnd) {
          out += emit(text.slice(i + 1, close), false, i, close + 1);
          i = close + 1;
          continue;
        }
      }
      out += loneDollar;
      i += 1;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Rewrites every math span outside code with `render`; a `$` that opens no math becomes `loneDollar`. */
export function transformMath(
  markdown: string,
  render: (span: MathSpan) => string,
  loneDollar = "\\$",
): string {
  if (!MAY_HAVE_MATH.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let chunk: string[] = [];
  let fence: { char: string; length: number } | null = null;
  const flush = () => {
    if (chunk.length === 0) return;
    out.push(transformText(chunk.join("\n"), render, loneDollar));
    chunk = [];
  };
  for (const line of lines) {
    if (fence) {
      out.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close?.[0] === fence.char && close.length >= fence.length) fence = null;
      continue;
    }
    const open = OPEN_FENCE.exec(line)?.[1];
    if (open) {
      flush();
      fence = { char: open[0] ?? "`", length: open.length };
      out.push(line);
      continue;
    }
    chunk.push(line);
  }
  flush();
  return out.join("\n");
}

/** The canonical Markdown both renderers parse (see the module comment). */
export function normalizeMathMarkdown(markdown: string): string {
  return transformMath(markdown, ({ tex, display, block }) => {
    if (block) return `$$\n${tex}\n$$`;
    return display ? `$$${tex}$$` : `$${tex}$`;
  });
}

/** Markdown with every formula replaced by readable text, for copy and plain-text views. */
export function mathToPlainText(markdown: string): string {
  return transformMath(markdown, ({ tex }) => texToUnicode(tex), "$");
}

// ---------------------------------------------------------------------------------------------
// TeX to readable Unicode text. Not a typesetter: it keeps numbers, units, Greek letters,
// operators, simple super- and subscripts and fractions legible inside a line of text.

const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  ast: "∗",
  star: "⋆",
  bullet: "•",
  circ: "∘",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  equiv: "≡",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  lt: "<",
  gt: ">",
  leqslant: "⩽",
  geqslant: "⩾",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  land: "∧",
  lor: "∨",
  wedge: "∧",
  vee: "∨",
  neg: "¬",
  lnot: "¬",
  oplus: "⊕",
  otimes: "⊗",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  implies: "⇒",
  iff: "⇔",
  mapsto: "↦",
  longrightarrow: "⟶",
  longleftarrow: "⟵",
  uparrow: "↑",
  downarrow: "↓",
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  ldots: "…",
  cdots: "⋯",
  dots: "…",
  vdots: "⋮",
  ddots: "⋱",
  prime: "′",
  degree: "°",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  lvert: "|",
  rvert: "|",
  vert: "|",
  lVert: "‖",
  rVert: "‖",
  Vert: "‖",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  wp: "℘",
  therefore: "∴",
  because: "∵",
  triangle: "△",
  square: "□",
  checkmark: "✓",
  dagger: "†",
  ddagger: "‡",
  S: "§",
  P: "¶",
  copyright: "©",
  quad: "\u2003",
  qquad: "\u2003\u2003",
  enspace: "\u2002",
  thinspace: "\u2009",
  ",": "\u2009",
  ":": "\u205F",
  ">": "\u205F",
  ";": "\u2004",
  " ": " ",
  "!": "",
  "\\": " ",
  "%": "%",
  $: "$",
  "&": "&",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  "|": "‖",
};

// Relations and binary operators read better with a space on each side.
const SPACED = new Set([
  "times",
  "cdot",
  "div",
  "pm",
  "mp",
  "le",
  "leq",
  "ge",
  "geq",
  "ne",
  "neq",
  "approx",
  "sim",
  "simeq",
  "cong",
  "equiv",
  "propto",
  "ll",
  "gg",
  "leqslant",
  "geqslant",
  "in",
  "notin",
  "ni",
  "subset",
  "subseteq",
  "supset",
  "supseteq",
  "cup",
  "cap",
  "setminus",
  "land",
  "lor",
  "wedge",
  "vee",
  "oplus",
  "otimes",
  "to",
  "rightarrow",
  "leftarrow",
  "gets",
  "leftrightarrow",
  "Rightarrow",
  "Leftarrow",
  "Leftrightarrow",
  "implies",
  "iff",
  "mapsto",
  "longrightarrow",
  "longleftarrow",
  "mid",
  "perp",
  "parallel",
]);

const FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "coth",
  "log",
  "ln",
  "lg",
  "exp",
  "lim",
  "limsup",
  "liminf",
  "max",
  "min",
  "sup",
  "inf",
  "det",
  "gcd",
  "deg",
  "dim",
  "ker",
  "arg",
  "Pr",
  "mod",
  "bmod",
  "hom",
]);

const CONTENT_COMMANDS = new Set([
  "text",
  "textrm",
  "textnormal",
  "textup",
  "textit",
  "textbf",
  "textsf",
  "texttt",
  "emph",
  "mbox",
  "hbox",
  "mathrm",
  "mathit",
  "mathbf",
  "mathsf",
  "mathtt",
  "mathnormal",
  "mathup",
  "boldsymbol",
  "bm",
  "operatorname",
  "mathcal",
  "mathscr",
  "mathfrak",
  "mathop",
  "mathbin",
  "mathrel",
  "mathord",
  "ensuremath",
  "displaystyle",
  "underbrace",
  "overbrace",
  "boxed",
  "fbox",
  "cancel",
  "bcancel",
  "xcancel",
  "smash",
]);

const TEXT_COMMANDS = new Set([
  "text",
  "textrm",
  "textnormal",
  "textup",
  "textit",
  "textbf",
  "textsf",
  "texttt",
  "mbox",
  "hbox",
  "mathrm",
  "operatorname",
]);

const IGNORED = new Set([
  "left",
  "right",
  "big",
  "Big",
  "bigg",
  "Bigg",
  "bigl",
  "bigr",
  "Bigl",
  "Bigr",
  "biggl",
  "biggr",
  "Biggl",
  "Biggr",
  "middle",
  "displaystyle",
  "textstyle",
  "scriptstyle",
  "scriptscriptstyle",
  "limits",
  "nolimits",
  "nonumber",
  "notag",
  "centering",
  "hline",
]);

const ACCENTS: Record<string, string> = {
  vec: "\u20D7",
  overrightarrow: "\u20D7",
  hat: "\u0302",
  widehat: "\u0302",
  bar: "\u0304",
  overline: "\u0305",
  tilde: "\u0303",
  widetilde: "\u0303",
  dot: "\u0307",
  ddot: "\u0308",
  underline: "\u0332",
  acute: "\u0301",
  grave: "\u0300",
  breve: "\u0306",
  check: "\u030C",
};

const DOUBLE_STRUCK: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  H: "ℍ",
  E: "𝔼",
  "1": "𝟙",
};

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
  T: "ᵀ",
  "*": "*",
  "′": "′",
  " ": "",
};

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "−": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
  " ": "",
};

function script(value: string, table: Record<string, string>, marker: string) {
  if (marker === "^") {
    if (value === "∘" || value === "°") return "°";
    if (/^′+$/.test(value)) return value;
  }
  const chars = Array.from(value);
  if (chars.length > 0 && chars.every((char) => table[char] !== undefined)) {
    return chars.map((char) => table[char]).join("");
  }
  return chars.length === 1 ? `${marker}${value}` : `${marker}(${value})`;
}

/** A fraction part keeps parentheses unless it is one number, word or symbol. */
function fractionPart(value: string) {
  const trimmed = value.trim();
  return /^[\p{L}\p{N}.,′°]+$/u.test(trimmed) || Array.from(trimmed).length <= 1
    ? trimmed
    : `(${trimmed})`;
}

class TexReader {
  private at = 0;
  constructor(private readonly source: string) {}

  read(): string {
    return this.sequence(false);
  }

  private sequence(inGroup: boolean): string {
    let out = "";
    while (this.at < this.source.length) {
      const char = this.source[this.at] ?? "";
      if (char === "}") {
        if (inGroup) {
          this.at++;
          return out;
        }
        this.at++;
        continue;
      }
      if (char === "^" || char === "_") {
        this.at++;
        const value = this.argument().trim();
        out += script(value, char === "^" ? SUPERSCRIPT : SUBSCRIPT, char);
        continue;
      }
      out = this.append(out, this.atom());
    }
    return out;
  }

  private append(out: string, piece: { text: string; textCommand?: boolean }) {
    // "1018.86\text{hPa}" reads as a number and its unit: keep a narrow gap between them.
    if (piece.textCommand && /[0-9]$/.test(out) && /^\p{L}/u.test(piece.text)) {
      return `${out}\u202F${piece.text}`;
    }
    return out + piece.text;
  }

  private skipSpaces() {
    while (WHITESPACE.test(this.source[this.at] ?? "")) this.at++;
  }

  private argument(): string {
    this.skipSpaces();
    const char = this.source[this.at];
    if (char === undefined) return "";
    if (char === "{") {
      this.at++;
      return this.sequence(true);
    }
    return this.atom().text;
  }

  private optional(): string | undefined {
    this.skipSpaces();
    if (this.source[this.at] !== "[") return undefined;
    const close = this.source.indexOf("]", this.at);
    if (close < 0) return undefined;
    const value = new TexReader(this.source.slice(this.at + 1, close)).read();
    this.at = close + 1;
    return value;
  }

  private atom(): { text: string; textCommand?: boolean } {
    const char = this.source[this.at] ?? "";
    if (char === "{") {
      this.at++;
      return { text: this.sequence(true) };
    }
    if (char === "\\") return this.command();
    this.at++;
    if (WHITESPACE.test(char)) {
      this.skipSpaces();
      return { text: " " };
    }
    if (char === "~") return { text: "\u00A0" };
    if (char === "&") return { text: " " };
    if (char === "'") return { text: "′" };
    if (char === "-") return { text: "−" };
    return { text: char };
  }

  private command(): { text: string; textCommand?: boolean } {
    this.at++;
    const letters = /^[A-Za-z]+/.exec(this.source.slice(this.at))?.[0];
    const name = letters ?? this.source[this.at] ?? "";
    this.at += name.length;
    if (letters) {
      // A control word swallows the spaces after it.
      while (this.source[this.at] === " ") this.at++;
    }
    if (TEXT_COMMANDS.has(name)) return { text: this.argument(), textCommand: true };
    if (CONTENT_COMMANDS.has(name)) return { text: this.argument() };
    if (IGNORED.has(name)) return { text: "" };
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
      const top = this.argument();
      const bottom = this.argument();
      return { text: `${fractionPart(top)}/${fractionPart(bottom)}` };
    }
    if (name === "binom" || name === "dbinom" || name === "tbinom") {
      const top = this.argument();
      const bottom = this.argument();
      return { text: `C(${top.trim()}, ${bottom.trim()})` };
    }
    if (name === "sqrt") {
      const index = this.optional();
      const value = this.argument().trim();
      const root = index ? `${script(index.trim(), SUPERSCRIPT, "^")}√` : "√";
      return { text: root + (Array.from(value).length > 1 ? `(${value})` : value) };
    }
    if (name === "mathbb" || name === "mathbbm") {
      const value = this.argument();
      return {
        text: Array.from(value)
          .map((c) => DOUBLE_STRUCK[c] ?? c)
          .join(""),
      };
    }
    const accent = ACCENTS[name];
    if (accent) return { text: this.argument() + accent };
    if (name === "overset" || name === "underset" || name === "stackrel") {
      this.argument();
      return { text: this.argument() };
    }
    if (name === "textcolor" || name === "colorbox") {
      this.argument();
      return { text: this.argument() };
    }
    if (name === "color" || name === "label" || name === "tag" || name === "phantom") {
      this.argument();
      return { text: "" };
    }
    if (name === "begin" || name === "end") {
      this.argument();
      if (name === "begin") this.optional();
      return { text: " " };
    }
    if (name === "not") {
      const next = this.atom().text;
      if (next === "=") return { text: "≠" };
      if (next === "∈") return { text: "∉" };
      return { text: `${next}\u0338` };
    }
    if (FUNCTIONS.has(name)) return { text: name === "bmod" ? " mod " : `${name} ` };
    const symbol = SYMBOLS[name];
    if (symbol !== undefined) return { text: SPACED.has(name) ? ` ${symbol} ` : symbol };
    return { text: name };
  }
}

/** Readable text for a TeX formula: "1018.86\text{hPa}" → "1018.86 hPa", "x^2" → "x²". */
export function texToUnicode(tex: string): string {
  try {
    return new TexReader(tex)
      .read()
      .replace(/[ \t\n]+/g, " ")
      .replace(/ ([,.;)\]])/g, "$1")
      .replace(/([([]) /g, "$1")
      .trim();
  } catch {
    return tex;
  }
}
