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

/** Words that make a message an instruction about the work (a new constraint or task). */
const WORK_INSTRUCTION =
  /^\s*(?:(?:per\s+favore|please|ora|adesso|poi|e|and|also|anche)\s+)*(?:non\s+\p{L}+|aggiungi\w*|togli\w*|rimuovi\w*|metti\w*|usa\b|usate\b|scrivi\w*|rifai\w*|correggi\w*|sistema\w*|modifica\w*|traduci\w*|genera\w*|crea\w*|salva\w*|invia\w*|manda\w*|lavora\w*|fai\b|fate\b|ricorda\w*|evita\w*|cambia\w*|sposta\w*|elimina\w*|don'?t|do\s+not|never|always|add|remove|use|write|redo|fix|change|translate|generate|create|save|send|work|make|avoid|move|delete)(?![\p{L}\p{N}_])/iu;

/** Question openers, Italian and English, for messages without a question mark. */
const QUESTION_OPENER =
  /^\s*(?:ma\s+|e\s+|and\s+|but\s+|so\s+)?(?:come|cosa|che\s+cosa|perch[eé]|quando|quanto|quanti|quante|dove|chi|quale|quali|stai|state|sei|hai|avete|c'?[eè]|si\s+pu[oò]|si\s+potr[aà]|potr[aà]|posso|possiamo|riesci|a\s+che\s+punto|what|how|why|when|where|who|which|is|are|was|were|can|could|will|would|do|does|did|have|has|any)(?![\p{L}\p{N}_])/iu;

/**
 * Whether a message written during an ongoing task is a side question or aside (a status or
 * information question) rather than a stop, a change or a new instruction. An aside is answered
 * and the task goes on; it never replaces or completes the original request.
 */
export function isAsideMessage(text: string): boolean {
  const value = text.normalize("NFKC").trim();
  if (!value || value.length > 400) return false;
  if (asksToStopOrChange(value)) return false;
  if (WORK_INSTRUCTION.test(value)) return false;
  return value.includes("?") || QUESTION_OPENER.test(value);
}

/**
 * Stand-by closing lines that hand the turn back to the user ("Sono a disposizione per le
 * prossime istruzioni", "let me know how to proceed"). In an unfinished long task they end the
 * work without finishing it.
 */
const STANDBY_CLOSE =
  /(?:\b(?:sono|resto|rimango|restiamo|rimaniamo)\s+a\s+(?:tua|vostra|completa|totale)?\s*disposizione\b|\battendo\s+(?:le\s+)?(?:tue|vostre|nuove|prossime|ulteriori)?\s*(?:istruzioni|indicazioni|direttive)\b|\bin\s+attesa\s+di\s+(?:tue|nuove|ulteriori|prossime)?\s*(?:istruzioni|indicazioni)\b|\b(?:fammi|fatemi)\s+sapere\s+(?:se|come)\b|\bdimmi\s+(?:pure\s+)?(?:se|come)\s+(?:vuoi\s+)?(?:procedere|continuare|proseguire)\b|\bprossime\s+istruzioni\b|\blet\s+me\s+know\s+(?:if|how|what)\b|\bawaiting\s+(?:your\s+)?(?:further\s+|next\s+)?instructions\b|\b(?:i\s*'?\s*a?m\s+)?(?:standing\s+by|at\s+your\s+disposal)\b|\bready\s+for\s+(?:your\s+)?(?:next|further)\s+instructions\b)/iu;

/** A claim that the whole requested job (not a chunk) is finished. */
const WHOLE_TASK_DONE =
  /(?:\b(?:il\s+)?(?:lavoro|task|compito|progetto|incarico)\s+(?:è\s+)?(?:stato\s+)?(?:interamente\s+|completamente\s+)?(?:complet\w+|finit\w+|terminat\w+|conclus\w+)\b|\b(?:tutto|tutti|tutte)\s+(?:è\s+|sono\s+)?(?:stat[oie]\s+)?(?:complet\w+|finit\w+|terminat\w+|fatt[oie])\b|\b100\s*%\s*(?:complet\w+|finit\w+|del\s+lavoro|del\s+progetto|done|complete)|\b(?:the\s+)?(?:whole\s+)?(?:task|job|work|project)\s+is\s+(?:now\s+)?(?:fully\s+)?(?:complete|done|finished)\b|\beverything\s+is\s+(?:now\s+)?(?:done|complete|finished)\b|\ball\s+done\b)/iu;

/** Words that say only a part was finished ("il blocco corrente è concluso"). */
const PARTIAL_SCOPE =
  /\b(?:blocco|lotto|batch|chunk|tranche|parte|porzione|fase|sezione|gruppo|step|passo)\s+(?:corrente|attuale|in\s+corso|current|this)\b|\b(?:current|this)\s+(?:batch|chunk|part|block|phase|section|step)\b/iu;

export function isStandbyClose(text: string): boolean {
  return STANDBY_CLOSE.test(text.normalize("NFKC"));
}

/** Whether the reply claims the whole job is done, with no "only this part" wording. */
export function claimsWholeTaskDone(text: string): boolean {
  const value = text.normalize("NFKC");
  return WHOLE_TASK_DONE.test(value) && !PARTIAL_SCOPE.test(value);
}

/** The reply without its trailing stand-by sentences (the work goes on after it). */
export function stripStandbyClose(text: string): string {
  const parts = text.split(/(?<=[.!?…])\s+|\n+/u);
  let cut = parts.length;
  while (cut > 0) {
    const part = parts[cut - 1]!.trim();
    if (!part) {
      cut--;
      continue;
    }
    if (isStandbyClose(part) || PARTIAL_SCOPE.test(part.normalize("NFKC"))) {
      cut--;
      continue;
    }
    break;
  }
  if (cut === parts.length) return text;
  // Keep the original spacing of what stays.
  let end = 0;
  let index = 0;
  for (const part of parts.slice(0, cut)) {
    index = text.indexOf(part, index);
    end = index + part.length;
    index = end;
  }
  return text.slice(0, end).trimEnd();
}
