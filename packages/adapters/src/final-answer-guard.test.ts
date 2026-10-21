import { describe, expect, it } from "vitest";
import {
  DEFAULT_DANGLING_NARRATION_NUDGES,
  danglingNarrationNudges,
  danglingNarrationPrompt,
  hasLeakedToolCall,
  looksLikeDanglingNarration,
  toolBudgetFinalSummaryEnabled,
  toolBudgetWrapUpPrompt,
} from "./final-answer-guard.js";

describe("looksLikeDanglingNarration", () => {
  it("flags the production case: announcement with a tool call leaked as text", () => {
    const text =
      'Leggiamo la sezione `## 8. Tabella riassuntiva` e la sezione finale per assicurarci di integrare in modo chiaro i 26 profili con le loro motivazioni prosopografiche accertate.call:default_api:shell{command:python3 -c "print(1)"}';
    expect(hasLeakedToolCall(text)).toBe(true);
    expect(looksLikeDanglingNarration(text)).toBe(true);
  });

  it("flags other leaked tool-call markups", () => {
    expect(looksLikeDanglingNarration('<tool_call>{"name":"shell"}</tool_call>')).toBe(true);
    expect(
      looksLikeDanglingNarration("```tool_code\nprint(default_api.shell(command='ls'))\n```"),
    ).toBe(true);
  });

  it("flags short announcements in Italian and English", () => {
    for (const text of [
      "Verifico il contenuto del file per vedere la struttura.",
      "Ora assemblo l'aggiornamento del dossier.",
      "Passo allo step 5: consolidamento finale.",
      "Let me check the remaining profiles.",
      "I’ll open the PDF and read section 3.",
      "Now I will update the summary table.",
      "**Cerchiamo** negli archivi belgi.",
    ]) {
      expect(looksLikeDanglingNarration(text), text).toBe(true);
    }
  });

  it("flags replies that introduce something that never came", () => {
    expect(looksLikeDanglingNarration("Ecco cosa ho trovato finora:")).toBe(true);
    expect(looksLikeDanglingNarration("The table now reads…")).toBe(true);
  });

  it("keeps concluding answers", () => {
    for (const text of [
      "Ho aggiornato il dossier: 24 profili su 26 hanno un riscontro. Scrivi «continua» per proseguire.",
      "Done: the file is updated and the backup is in backups/2026-10-21.",
      "A Roma domani 21 °C e sole.",
      "Ora il file è aggiornato.",
      "",
    ]) {
      expect(looksLikeDanglingNarration(text), text).toBe(false);
    }
  });

  it("keeps structured or long answers that open with an announce verb", () => {
    expect(
      looksLikeDanglingNarration(
        "Vediamo i risultati.\n\n- Horta: massone\n- Binet: nessun riscontro",
      ),
    ).toBe(false);
    expect(looksLikeDanglingNarration(`Let me summarize. ${"Result line. ".repeat(80)}`)).toBe(
      false,
    );
  });
});

describe("final-answer guard settings and prompts", () => {
  it("parses DANGLING_NARRATION_NUDGES", () => {
    expect(danglingNarrationNudges({})).toBe(DEFAULT_DANGLING_NARRATION_NUDGES);
    expect(danglingNarrationNudges({ DANGLING_NARRATION_NUDGES: "0" })).toBe(0);
    expect(danglingNarrationNudges({ DANGLING_NARRATION_NUDGES: "1" })).toBe(1);
    expect(danglingNarrationNudges({ DANGLING_NARRATION_NUDGES: "99" })).toBe(5);
    expect(danglingNarrationNudges({ DANGLING_NARRATION_NUDGES: "x" })).toBe(
      DEFAULT_DANGLING_NARRATION_NUDGES,
    );
  });

  it("parses TOOL_BUDGET_FINAL_SUMMARY", () => {
    expect(toolBudgetFinalSummaryEnabled({})).toBe(true);
    expect(toolBudgetFinalSummaryEnabled({ TOOL_BUDGET_FINAL_SUMMARY: "1" })).toBe(true);
    for (const off of ["0", "false", "OFF", "no"]) {
      expect(toolBudgetFinalSummaryEnabled({ TOOL_BUDGET_FINAL_SUMMARY: off })).toBe(false);
    }
  });

  it("asks for a concluding summary that mentions continua and forbids announcing", () => {
    for (const prompt of [danglingNarrationPrompt(), toolBudgetWrapUpPrompt(500)]) {
      expect(prompt).toContain("what was done");
      expect(prompt).toContain("what still remains");
      expect(prompt).toContain("continua");
      expect(prompt).toContain("do not announce");
      expect(prompt).not.toContain("stay silent");
    }
    expect(toolBudgetWrapUpPrompt(500)).toContain("500 tool calls");
    expect(toolBudgetWrapUpPrompt(500, true)).toContain("stay silent");
    expect(danglingNarrationPrompt(true)).toContain("stay silent");
  });
});
