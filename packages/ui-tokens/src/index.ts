export const APPEARANCE_PREFERENCES = ["system", "light", "dark", "black"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark" | "black";

export const UI_APPEARANCE_STORAGE_KEY = "rakazo.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  /** Backing behind a link's site icon. White in both themes so dark logos stay visible. */
  faviconPlate: string;
  success: string;
  warning: string;
  statusWorking: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

export const darkTokens = {
  background: "#181A1E",
  foreground: "#ECECEE",
  card: "#212328",
  cardForeground: "#ECECEE",
  popover: "#212328",
  popoverForeground: "#ECECEE",
  primary: "#F1F1EF",
  primaryForeground: "#181A1E",
  secondary: "#25272D",
  secondaryForeground: "#ECECEE",
  chatUser: "#2E3038",
  chatUserForeground: "#ECECEE",
  muted: "#212328",
  mutedForeground: "#95959B",
  accent: "#282A31",
  accentForeground: "#ECECEE",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#2C2F36",
  input: "#25272D",
  ring: "#3B82F6",
  sidebar: "#1C1E22",
  sidebarForeground: "#ECECEE",
  sidebarBorder: "#2A2C33",
  sidebarAccent: "#282A31",
  sidebarAccentForeground: "#ECECEE",
  link: "#3B82F6",
  faviconPlate: "#FFFFFF",
  success: "#4ECB71",
  warning: "#E9C46A",
  statusWorking: "#3B82F6",
  overlay: "rgba(8, 9, 11, 0.72)",
  scrollbar: "#2C2F36",
  scrollbarHover: "#3A3D47",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FAFAF8",
  foreground: "#1A1A1A",
  card: "#FFFFFF",
  cardForeground: "#1A1A1A",
  popover: "#FFFFFF",
  popoverForeground: "#1A1A1A",
  primary: "#1A1A1A",
  primaryForeground: "#F1F1EF",
  secondary: "#F0F0ED",
  secondaryForeground: "#1A1A1A",
  chatUser: "#E2E2DC",
  chatUserForeground: "#1A1A1A",
  muted: "#F0F0ED",
  mutedForeground: "#6C6C70",
  accent: "#EAEAE6",
  accentForeground: "#1A1A1A",
  destructive: "#DC2626",
  destructiveForeground: "#FFFFFF",
  border: "#F0F0ED",
  input: "#EAEAE6",
  ring: "#6C6C70",
  sidebar: "#ECECE9",
  sidebarForeground: "#1A1A1A",
  sidebarBorder: "#E8E8E4",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#1A1A1A",
  link: "#2563EB",
  faviconPlate: "#FFFFFF",
  success: "#228B3B",
  warning: "#B7791F",
  statusWorking: "#2563EB",
  overlay: "rgba(20, 20, 22, 0.45)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
} as const satisfies ColorTokens;


export const blackTokens = {
  background: "#000000",
  foreground: "#ECECEE",
  card: "#0A0A0A",
  cardForeground: "#ECECEE",
  popover: "#0A0A0A",
  popoverForeground: "#ECECEE",
  primary: "#F1F1EF",
  primaryForeground: "#000000",
  secondary: "#111111",
  secondaryForeground: "#ECECEE",
  chatUser: "#1A1A1A",
  chatUserForeground: "#ECECEE",
  muted: "#0A0A0A",
  mutedForeground: "#85858A",
  accent: "#111111",
  accentForeground: "#ECECEE",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#1A1A1A",
  input: "#111111",
  ring: "#3B82F6",
  sidebar: "#000000",
  sidebarForeground: "#ECECEE",
  sidebarBorder: "#1A1A1A",
  sidebarAccent: "#111111",
  sidebarAccentForeground: "#ECECEE",
  link: "#3B82F6",
  faviconPlate: "#FFFFFF",
  success: "#4ECB71",
  warning: "#E9C46A",
  statusWorking: "#3B82F6",
  overlay: "rgba(0, 0, 0, 0.8)",
  scrollbar: "#1A1A1A",
  scrollbarHover: "#2A2A2A",
} as const satisfies ColorTokens;

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

export const RADIUS = "0.75rem";

export const botColors = [
  "#3EC5A8",
  "#F5A03C",
  "#6A6BF5",
  "#9B5CF6",
  "#3B82F6",
  "#F2622A",
  "#D9508A",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark" || value === "black";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "system";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: "light" | "dark" = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  if (appearance === "light") return lightTokens;
  if (appearance === "black") return blackTokens;
  return darkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof ColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: "light" | "dark", palette: ColorTokens) {
  const lines = (Object.keys(palette) as (keyof ColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join("\n")}\n  --radius: ${RADIUS};\n}`;
}

/** The CSS in `tokens.css`. Generated from the TS palette so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @rakazo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", darkTokens),
    renderBlock('[data-theme="light"]', "light", lightTokens),
    renderBlock('[data-theme="black"]', "dark", blackTokens),
  ].join("\n\n")}\n`;
}
