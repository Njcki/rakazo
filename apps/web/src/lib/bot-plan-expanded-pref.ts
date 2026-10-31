/**
 * RAKAZO: whether the bot panel's Plan section is expanded. One global choice for every bot,
 * remembered in localStorage; expanded until the user collapses it.
 */
export const BOT_PLAN_EXPANDED_STORAGE_KEY = "rakazo.botPanel.planExpanded";

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readBotPlanExpanded(
  storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(BOT_PLAN_EXPANDED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function persistBotPlanExpanded(
  expanded: boolean,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(BOT_PLAN_EXPANDED_STORAGE_KEY, expanded ? "true" : "false");
  } catch {
    // Storage blocked or full: the choice still holds for this session.
  }
}
