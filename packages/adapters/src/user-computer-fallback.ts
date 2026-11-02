import type { RunContext } from "./run-context.js";

/**
 * When the user's computer is offline (or unreachable from this conversation), the bot works on
 * its own computer instead of asking the user and waiting, and says so in its reply.
 */

/** Bot instructions that send work to the user's own machine. */
const WANTS_USER_COMPUTER =
  /(\b(pc|computer|macchina|portatile|laptop)\s+(locale|dell['’]utente|personale|di\s+casa|windows|dell['’]owner)|\blocal\s+(pc|computer|machine)\b|\buser['’]s\s+(pc|computer|machine|desktop)\b|\b(windows|mac)\s+(pc|machine)\b|\b[a-z]:\\(users|utenti)\\|\buser_computer_\w+|\brakazo\s+desktop\b)/i;

export function instructionsWantUserComputer(text: string | undefined): boolean {
  return Boolean(text && WANTS_USER_COMPUTER.test(text));
}

const COMPUTER_WORD = /\b(pc|computer|desktop|windows|mac|portatile|laptop|macchina)\b/i;
const UNAVAILABLE_WORD =
  /\b(offline|spent[oa]|non\s+(è\s+|e\s+)?(connesso|collegato|raggiungibile|disponibile|acceso|online)|disconness\w*|scollegat\w*|irraggiungibile|not\s+(connected|reachable|available|online)|unreachable|disconnected|turned\s+off|unavailable|apri(re)?\s+(l['’])?app|open\s+the\s+(rakazo\s+)?desktop\s+app)\b/i;

/** An ask_user that only asks what to do about the unavailable computer. */
export function asksAboutUnavailableComputer(
  question: string,
  options: readonly string[],
): boolean {
  const text = [question, ...options].join("\n");
  return COMPUTER_WORD.test(text) && UNAVAILABLE_WORD.test(text);
}

export const ASK_USER_COMPUTER_REFUSAL =
  "Do not ask the user about their computer: it is offline. Continue the task on your own computer (your own shell, files and browser) now, without waiting. Use the same files if you have copies or can fetch them; if something only exists on their computer, do everything else and list that part as pending. In your reply, tell the user once that their computer was offline so you used your own computer.";

export const USER_COMPUTER_UNAVAILABLE_FALLBACK =
  "The user's computer is not connected. Do not ask the user or wait for it: continue the task on your own computer (your own shell, files and browser) and tell the user once in your reply that their computer was offline so you used your own.";

/** The prompt line for a run whose instructions rely on a computer it cannot reach. */
export const USER_COMPUTER_OFFLINE_INSTRUCTION =
  "The user's computer is offline. Do not ask the user about it or wait for it, even if your instructions say to use their PC: do the work on your own computer (your own shell, files and browser) instead, and tell the user once in your reply that their computer was offline so you used your own computer.";

const MENTIONS_FALLBACK =
  /\b(offline|spent[oa]|non\s+(era|è|e)\s+(connesso|collegato|raggiungibile|disponibile|acceso)|not\s+(connected|reachable|available|online)|unreachable|disconnected|mio\s+computer|my\s+own\s+computer)\b/i;

export function replyMentionsComputerFallback(text: string): boolean {
  return MENTIONS_FALLBACK.test(text);
}

const ITALIAN_HINT =
  /\b(il|lo|la|gli|le|di|che|non|sono|ho|per|una|del|della|nel|questo|tutti|anche|perché|già)\b/gi;
const ENGLISH_HINT = /\b(the|and|is|are|have|has|this|that|with|for|was|not|done|of)\b/gi;

export function userComputerFallbackNotice(replyText: string): string {
  const it = replyText.match(ITALIAN_HINT)?.length ?? 0;
  const en = replyText.match(ENGLISH_HINT)?.length ?? 0;
  return it >= en && it > 0
    ? "Nota: il tuo PC era offline, quindi ho lavorato sul mio computer."
    : "Note: your computer was offline, so I worked on my own computer.";
}

/**
 * ask_user guard: while the user's computer cannot be used, a question about it is refused and
 * the run carries on on its own computer.
 */
export function refuseAskUserAboutComputer(
  ctx: Pick<RunContext, "state">,
  question: string,
  options: readonly string[],
): string | undefined {
  const fallback = ctx.state.userComputerFallback;
  if (!fallback || fallback.state === "connected") return undefined;
  if (!asksAboutUnavailableComputer(question, options)) return undefined;
  fallback.triggeredThisRun = true;
  return ASK_USER_COMPUTER_REFUSAL;
}
