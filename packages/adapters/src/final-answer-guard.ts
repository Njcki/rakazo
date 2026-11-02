/**
 * Final-answer guard for long tool runs (self-host patch 0026).
 *
 * Some OpenAI-compatible models (seen with Gemini behind a reply proxy) end a
 * tool run with a text-only turn that only announces the next step ("Let me
 * read section 8…"), sometimes with the tool call leaked as plain text. The
 * runtime used to store that sentence as the final answer. This module decides
 * when such a reply deserves one internal nudge, and holds the prompts for the
 * nudge and for the tool-budget wrap-up call.
 */

/** Default cap on dangling-narration nudges per run. */
export const DEFAULT_DANGLING_NARRATION_NUDGES = 4;

/** Short replies are where announcements hide; long ones are real answers. */
const SHORT_REPLY_CHARS = 700;

// Tool calls written as text instead of a native tool call. These forms are
// emitted by Gemini and other models when the call is not lifted into tool_calls.
const LEAKED_TOOL_CALL_PATTERNS: RegExp[] = [
  /\bcall:[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*\s*\{/,
  /<\/?tool_call\b/i,
  /<\/?function_calls?\b/i,
  /```\s*tool_(?:code|call)\b/i,
  /\bdefault_api\.[A-Za-z_]\w*\s*\(/,
  /\[TOOL_CALLS?\]/,
];

// First words that announce an action instead of reporting a result. Kept to
// unambiguous forms (first person or "let's") in the languages Rakazo ships
// plus a few common ones; a miss only means the old behavior.
const ANNOUNCE_OPENERS = new RegExp(
  `^(?:${[
    // Italian
    "leggiamo",
    "leggo",
    "vediamo",
    "vedo di",
    "verifico",
    "verifichiamo",
    "controllo",
    "controlliamo",
    "cerchiamo",
    "cerco",
    "esaminiamo",
    "esamino",
    "procedo",
    "procediamo",
    "passo a",
    "passo allo",
    "passo al",
    "passiamo",
    "proseguo",
    "proseguiamo",
    "continuo",
    "continuiamo",
    "apro",
    "apriamo",
    "scarico",
    "aggiorno",
    "eseguo",
    "lancio",
    "analizzo",
    "analizziamo",
    "recupero",
    "ora (?:leggo|verifico|controllo|cerco|apro|passo|procedo|aggiorno|assemblo|eseguo|analizzo|scrivo|preparo)",
    "adesso (?:leggo|verifico|controllo|cerco|apro|passo|procedo|aggiorno|eseguo|analizzo|scrivo|preparo)",
    "prima (?:leggo|verifico|controllo|faccio)",
    // English
    "let me",
    "let's",
    "lets",
    "i'll",
    "i will",
    "i'm going to",
    "i am going to",
    "next,? i",
    "now,? (?:i|let)",
    "first,? (?:i|let)",
    // Spanish / French / German
    "voy a",
    "vamos a",
    "veamos",
    "je vais",
    "voyons",
    "ich werde",
    "lass(?:t)? uns",
  ].join("|")})\\b`,
  "iu",
);

// A final reply that ends by promising more work ("continuo con…", "I'll continue with…") even
// though nothing runs after it. Matched only in the last paragraph, so long and structured
// replies are covered too.
// \b is ASCII-only even with the u flag, so accented endings ("continuerò") need these.
const WORD_START = "(?<![\\p{L}\\p{N}_])";
const WORD_END = "(?![\\p{L}\\p{N}_])";

const CONTINUATION_PROMISE = new RegExp(
  `${WORD_START}(?:${[
    // Italian
    "(?:ora |adesso |subito |quindi |poi )?(?:continuo|continuerò|continueremo|proseguo|proseguirò|procedo|procederò|riprendo|riprenderò)",
    "(?:ora|adesso|subito|quindi) passo (?:a|al|allo|alla|ai|agli|alle)",
    "passo (?:ora|adesso|subito) (?:a|al|allo|alla|ai|agli|alle)",
    "nel prossimo (?:messaggio|turno|passaggio|step|aggiornamento)",
    "(?:a breve|tra poco|fra poco) (?:ti )?(?:invio|mando|aggiorno|completo|continuo|preparo)",
    "ti (?:aggiorno|aggiornerò|faccio sapere|farò sapere) (?:a breve|appena|quando|non appena)",
    "sto (?:continuando|procedendo|lavorando)",
    // English
    "(?:i'll|i will|i'm going to|i am going to|let me|now i'll|next,? i'll|next,? i will) (?:now |then |next )?(?:continue|proceed|keep going|move on|go on|resume|carry on|get (?:back )?to|work on|start on|finish)",
    "(?:continuing with|moving on to|proceeding (?:with|to)|stay tuned|i'll follow up|will follow up shortly|in the next (?:message|turn|step|update))",
  ].join("|")})${WORD_END}`,
  "iu",
);

// An offer, a condition or a question hands the turn back to the user: a correct ending.
const HANDS_BACK = new RegExp(
  `\\?|${WORD_START}(?:${[
    "se vuoi",
    "se preferisci",
    "se ti va",
    "se (?:mi )?confermi",
    "appena (?:mi )?(?:dici|confermi)",
    "vuoi che",
    "fammi sapere",
    "dimmi (?:se|tu)",
    "quando vuoi",
    "con il tuo ok",
    "if you(?:'d)? (?:want|like|prefer)",
    "let me know",
    "would you like",
    "shall i",
    "should i",
    "want me to",
    "once you confirm",
    "if you confirm",
  ].join("|")})${WORD_END}`,
  "iu",
);

/** The last paragraph of a reply, without list markers or emphasis. */
function lastParagraph(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const last = paragraphs.at(-1) ?? "";
  const lines = last
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? "").replace(/^(?:[-*•>#]+|\d+[.)])\s*/u, "").replace(/[*_`]/gu, "");
}

/** The last sentence of a paragraph (or the paragraph when it has one sentence). */
function lastSentence(paragraph: string): string {
  const sentences = paragraph
    .split(/(?<=[.!…])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.at(-1) ?? paragraph;
}

/**
 * Whether a reply ends by promising to keep working. Applies to replies of any length: the
 * promise sits in the last paragraph of a long, structured report as often as in a one-liner.
 */
export function endsWithContinuationPromise(text: string): boolean {
  const paragraph = lastParagraph(text.trim()).replace(/[’ʼ]/gu, "'");
  if (!paragraph || HANDS_BACK.test(paragraph)) return false;
  const tail = paragraph.length > 400 ? lastSentence(paragraph) : paragraph;
  return CONTINUATION_PROMISE.test(tail);
}

function stripTrailingDecoration(text: string): string {
  return text.replace(/[\s*_`"'»”)\]]+$/u, "");
}

/** True when the reply contains a tool call written as text. */
export function hasLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether a text-only reply that came right after tool results looks like an
 * announced next step rather than a concluding answer.
 *
 * Signals, strongest first:
 * - a tool call leaked into the text (any length);
 * - a reply ending in ":" or an ellipsis, i.e. introducing something that never came;
 * - a short single-block reply that opens with an "I'll / let me / leggiamo" form.
 */
export function looksLikeDanglingNarration(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (hasLeakedToolCall(trimmed)) return true;
  const tail = stripTrailingDecoration(trimmed);
  if (/(?::|…|\.\.\.)$/u.test(tail) && trimmed.length <= SHORT_REPLY_CHARS * 2) return true;
  if (endsWithContinuationPromise(trimmed)) return true;
  if (trimmed.length > SHORT_REPLY_CHARS) return false;
  // Structured replies (paragraphs, lists, headings, tables) are answers.
  if (/\n\s*\n|\n\s*(?:[-*•]|\d+[.)]|#{1,6}\s|\|)/u.test(trimmed)) return false;
  const opener = trimmed.replace(/^[\s*_>#-]+/u, "").replace(/[’ʼ]/gu, "'");
  return ANNOUNCE_OPENERS.test(opener);
}

/** Optional override: DANGLING_NARRATION_NUDGES=0 disables, default 4, max 5. */
export function danglingNarrationNudges(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DANGLING_NARRATION_NUDGES?.trim();
  if (!raw) return DEFAULT_DANGLING_NARRATION_NUDGES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DANGLING_NARRATION_NUDGES;
  return Math.min(5, Math.floor(parsed));
}

/** TOOL_BUDGET_FINAL_SUMMARY=0 (or false/off) keeps the old stop-message-only behavior. */
export function toolBudgetFinalSummaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.TOOL_BUDGET_FINAL_SUMMARY?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

const FINAL_SUMMARY_SHAPE =
  'In the user\'s language, summarize what was done, what was found, and what still remains, and tell the user they can reply "continua" (continue) to go on. Write it as a conclusion: do not announce actions you are about to take.';

const SILENT_CLAUSE =
  " If you were instructed to stay silent when there is nothing to report, follow that instruction for the entire final assistant reply.";

const CONTINUE_LATER_CLAUSE =
  " If real work remains that will not fit in this turn, call continue_later with a short progress summary instead: the next part then starts automatically. Never end with a promise to continue; nothing runs after a final answer.";

const NO_PROMISE_CLAUSE =
  " Do not promise to continue later: nothing runs after a final answer, so say clearly whether the task is done or stopped, and what is left.";

export function danglingNarrationPrompt(
  allowSilentEmpty?: boolean,
  continueLaterOffered?: boolean,
): string {
  return (
    "Your last message announced a next step (or promised to continue) but did not call any tool, so nothing was executed and nothing will run after this turn. " +
    "If the task still needs work, continue now by actually calling the tools (native tool calls only, never written as text). " +
    `If the task is complete or you cannot continue, write the final answer to the user instead. ${FINAL_SUMMARY_SHAPE}` +
    (continueLaterOffered ? CONTINUE_LATER_CLAUSE : NO_PROMISE_CLAUSE) +
    (allowSilentEmpty ? SILENT_CLAUSE : "")
  );
}

export function toolBudgetWrapUpPrompt(
  limit: number,
  allowSilentEmpty?: boolean,
  continueLaterOffered?: boolean,
): string {
  if (continueLaterOffered) {
    return (
      `The limit of ${limit} tool calls for this turn has been reached. The only tool left is continue_later. ` +
      "If the task still has work left, call continue_later now with a short progress summary in the user's language (what is done, what is next, percent if known): the next part starts automatically with a fresh budget. " +
      "If the task is complete, write the final answer instead, without calling any tool. Never promise to continue in a final answer." +
      (allowSilentEmpty ? SILENT_CLAUSE : "")
    );
  }
  return (
    `The limit of ${limit} tool calls for this turn has been reached, so no tools are available any more. ` +
    "Do not call or write any tool call. Write the final answer to the user now, based only on what you already have. " +
    FINAL_SUMMARY_SHAPE +
    (allowSilentEmpty ? SILENT_CLAUSE : "")
  );
}

// Patch 0027: user messages that arrive while a run is working (mid-run steering).

/** STEERING_CONTINUE_NOTE=0 (or false/off/no) injects mid-run messages verbatim, as before. */
export function steeringContinueNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.STEERING_CONTINUE_NOTE?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

export const MID_RUN_STEERING_NOTE =
  "[The user sent the message below while you are still working on the current task. " +
  "Acknowledge it in one short line in the user's language (if it asks for status or a summary, give that briefly), with the message_user tool if available or in text alongside your next tool call, then continue the original task. " +
  "Stop or change course only if the user explicitly asks you to.]";

/** Frames a mid-run steering message so a status question does not end the work. */
export function frameMidRunSteering(text: string): string {
  return `${MID_RUN_STEERING_NOTE}\n\n${text}`;
}

export function steeringContinuePrompt(allowSilentEmpty?: boolean): string {
  return (
    "You answered the user's message sent during the task, but did not call any tool, so the original task is paused. " +
    "Unless the user explicitly asked you to stop or change course, continue the original task now with native tool calls; do not repeat the status update. " +
    `If the user asked you to stop, or the task is actually complete, write the final answer instead. ${FINAL_SUMMARY_SHAPE}` +
    (allowSilentEmpty ? SILENT_CLAUSE : "")
  );
}
