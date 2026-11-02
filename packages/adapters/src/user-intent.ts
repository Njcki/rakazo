/**
 * What the user asked for in the current request, read from their own messages: whether they
 * asked to stop, cancel or change the work (which alone lets a plan with open work be closed),
 * and whether the request is a long task (which makes the platform plan it).
 */

/** Explicit stop / cancel / change-of-work words, Italian and English. */
const STOP_REQUEST =
  /\b(stop+|basta|ferm(a|ati|atevi|iamoci)|interromp\w*|annull\w*|lascia(mo)?\s+(stare|perdere)|non\s+(serve|occorre)\s+pi[uù]|non\s+(continuare|proseguire|andare\s+avanti)|smetti\w*|abbandona\w*|rinuncia\w*|cambi(a|amo|o)\s+(di\s+)?(piano|programma|lavoro|strategia|idea|approccio)|cambio\s+di\s+(piano|programma)|invece\b|cancel+\w*|abort\w*|halt|never\s*mind|forget\s+(it|about\s+it|the\s+rest)|drop\s+(it|this|the\s+rest)|don'?t\s+(continue|bother|go\s+on)|change\s+(of\s+)?(the\s+)?(plan|task|approach)|instead\b|skip\s+the\s+rest)(?![\p{L}\p{N}_])/iu;

export function asksToStopOrChange(text: string): boolean {
  return STOP_REQUEST.test(text.normalize("NFKC"));
}

/** "Go all the way" requests, Italian and English. */
const LONG_REQUEST =
  /(fino\s+(al|a)\s*100\s*%|\b100\s*%|\bfino\s+(alla\s+fine|in\s+fondo)|\bprosegu\w*|\bcontinua\w*\b|\bvai\s+avanti|\bandare\s+avanti|\bfai\s+tutto|\btutt[oaie]\s+(il|lo|la|i|gli|le|quant[oaie])\b|\bcomplet(a|alo|ala|are|ali|ale)\b|\bfinisci\w*|\btermina\w*|\bogni\s+(file|riga|voce|capitolo|pagina)|\ball\s+of\s+(it|them)|\beverything\b|\bthe\s+whole\b|\bkeep\s+going|\buntil\s+(it'?s\s+)?(done|finished|complete|the\s+end)|\bfinish\b|\bcomplete\s+(it|all|the|everything)|\bevery\s+(file|line|item|page|chapter))/i;

export function looksLikeLongTask(text: string): boolean {
  return LONG_REQUEST.test(text.normalize("NFKC"));
}

/** Tool calls of real work after which a run without a plan counts as a long task anyway. */
export function autoPlanMinTools(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.AUTO_PLAN_MIN_TOOLS);
  return Number.isInteger(value) && value > 0 ? value : 12;
}

/** Real work needed before a "fino al 100%"-style request gets a plan. */
export const AUTO_PLAN_MIN_TOOLS_FOR_LONG_REQUEST = 3;

/**
 * Whether a run without a plan is multi-step work the platform must plan. Short chats never
 * qualify: they do little or no tool work.
 */
export function needsAutoPlan(input: {
  requestTexts: readonly string[];
  workToolCalls: number;
  minTools?: number;
}): boolean {
  const minTools = input.minTools ?? autoPlanMinTools();
  if (input.workToolCalls >= minTools) return true;
  return (
    input.workToolCalls >= AUTO_PLAN_MIN_TOOLS_FOR_LONG_REQUEST &&
    input.requestTexts.some((text) => looksLikeLongTask(text))
  );
}
