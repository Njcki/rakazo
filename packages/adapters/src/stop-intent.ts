/**
 * Whether a user message sent during a long chain asks to stop the work now. Only explicit,
 * imperative and non-negated commands count ("stop", "fermati", "basta così", "annulla"):
 * "non fermarti", "si è fermato", "ha smesso", "don't stop" never do. Wording that only
 * mentions stopping goes to a quick classifier when one is available, else it does not count.
 */
import { asksToStopOrChange } from "./user-intent.js";

const EXPLICIT_STOP =
  /(?<![\p{L}\p{N}_])(stop+|fermati|fermatevi|fermiamoci|ferma\s+(tutto|il\s+lavoro|la\s+catena|qui)|basta\s+(cos[iì]|cos[iì]\s+grazie|qui|adesso|ora|per\s+oggi)|annulla\s+(tutto|il\s+lavoro)|interrompi\s+(tutto|il\s+lavoro|subito)|smettila|smetti\s+(pure|di\s+lavorare|ora|adesso|subito)|cancel\s+(it|this|everything|the\s+task)|abort|halt|stop\s+(now|here|working|everything|it))(?![\p{L}\p{N}_])/giu;

/** A negation right before the command: "non fermarti", "non ti fermare", "don't stop". */
const NEGATION_BEFORE =
  /(?:\bnon\s+(?:ti\s+|vi\s+|ci\s+)?|\bmai\s+|\bnessun[oa]?\s+|\bsenza\s+|\bdon'?t\s+|\bdo\s+not\s+|\bnever\s+|\bwithout\s+|\bno\s+|\bnot\s+)$/iu;

/** Bare word message: "stop", "Basta!", "annulla." */
const BARE_STOP = /^\s*(stop+|basta|fermati|annulla|cancel|abort|halt)\s*[.!]*\s*$/iu;

export function isExplicitStopCommand(text: string): boolean {
  const value = text.normalize("NFKC");
  if (BARE_STOP.test(value)) return true;
  for (const match of value.matchAll(EXPLICIT_STOP)) {
    const before = value.slice(Math.max(0, match.index - 24), match.index);
    if (NEGATION_BEFORE.test(before)) continue;
    const after = value.slice(match.index + match[0].length, match.index + match[0].length + 30);
    // "fermati solo quando hai finito": a condition for later, not a stop now.
    if (
      /^\s*,?\s*(solo\s+|soltanto\s+)?(quando|se|appena|dopo|only\s+when|when|if|once|after)\b/i.test(
        after,
      )
    )
      continue;
    // "fino allo stop", "il bottone stop": a noun after an article/preposition is not a command.
    if (/^stop/i.test(match[0]) && /\b(lo|il|allo|dello|nello|the|a|to)\s+$/i.test(before))
      continue;
    return true;
  }
  return false;
}

/** Wording that might ask to stop but is not explicit enough to decide alone. */
export function mentionsStopping(text: string): boolean {
  return asksToStopOrChange(text);
}

export const STOP_CLASSIFIER_INSTRUCTIONS =
  'You classify ONE message a user sent while an assistant was working on a long task. Answer with JSON only: {"stop": true|false}. stop=true only when the message tells the assistant to stop, cancel or abandon the current work NOW. stop=false for: describing that something stopped ("si è fermato", "it stopped"), asking not to stop ("non fermarti", "don\'t stop"), conditions or rules for later ("fermati solo quando hai finito"), questions, feedback, or asking to continue.';

export function parseStopVerdict(text: string | undefined): boolean | undefined {
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as { stop?: unknown };
    return typeof parsed.stop === "boolean" ? parsed.stop : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The decision for the messages of a chain written AFTER its start (never the request itself):
 * an explicit command stops; ambiguous wording asks the classifier (no classifier: no stop).
 */
export async function messagesAskToStop(
  texts: readonly string[],
  classify?: (text: string) => Promise<boolean | undefined>,
): Promise<{ stop: boolean; via?: "explicit" | "classifier" }> {
  for (const text of texts) {
    if (isExplicitStopCommand(text)) return { stop: true, via: "explicit" };
  }
  if (!classify) return { stop: false };
  for (const text of texts) {
    if (!mentionsStopping(text)) continue;
    if ((await classify(text).catch(() => undefined)) === true)
      return { stop: true, via: "classifier" };
  }
  return { stop: false };
}
