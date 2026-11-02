import type { AgentRunModel, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFallbackQuickReply,
  buildQuickReplyPrompt,
  callQuickReplyModel,
  createQuickReplyCoordinator,
  frameQuickAckedSteering,
  isFillerQuickReply,
  parseQuickReplyModel,
  QUICK_ACKED_FOLLOWUP_NOTE,
  QUICK_ACKED_STEERING_NOTE,
  type QuickReplyContext,
  type QuickReplyFailureLog,
  type QuickReplyItem,
  type QuickReplyPostedLog,
  quickReplyConfig,
  quickReplyEligible,
  sanitizeQuickReply,
  startRunQuickReply,
  withQuickReplyTexts,
} from "./quick-reply.js";

const MODEL: AgentRunModel = { provider: "google", id: "gemini-3.8-flash" };

function item(n: number, text = `messaggio ${n}`): QuickReplyItem {
  return { id: `s-${n}`, messageId: `m-${n}`, text };
}

function context(overrides: Partial<QuickReplyContext> = {}): QuickReplyContext {
  return {
    botName: "Ricercatore",
    persona: "Ricercatore: fa ricerche e scrive report in italiano.",
    task: "Crea un PDF per smartphone sulla ricerca.",
    plan: {
      title: "PDF ricerca",
      status: "active",
      progress: { done: 1, total: 3 },
      steps: [
        { index: 1, title: "Raccogliere le fonti", status: "done" },
        { index: 2, title: "Scrivere l'HTML", status: "in_progress" },
        { index: 3, title: "Generare il PDF", status: "todo" },
      ],
    },
    recentActivity: [{ text: "Running shell: chromium --headless", at: 1_000_000 - 20_000 }],
    recentUpdates: ["Ho raccolto 12 fonti."],
    runStartedAt: 1_000_000 - 185_000,
    now: 1_000_000,
    ...overrides,
  };
}

describe("quickReplyConfig followUp", () => {
  it.each([
    ["0", false],
    ["false", false],
    ["off", false],
    ["1", true],
    ["on", true],
  ])("QUICK_REPLY_FOLLOWUP=%s -> %s", (raw, expected) => {
    expect(quickReplyConfig({ QUICK_REPLY_FOLLOWUP: raw }).followUp).toBe(expected);
  });
});

describe("quickReplyConfig", () => {
  it("defaults on with low reasoning and the backup model", () => {
    const config = quickReplyConfig({});
    expect(config).toMatchObject({
      enabled: true,
      model: undefined,
      reasoning: "low",
      timeoutMs: 9000,
      smartMs: 7000,
      debounceMs: 1500,
      pollMs: 1500,
      maxChars: 300,
      prefix: "⚡ ",
      followUp: true,
    });
  });

  it("reads every variable and clamps bad values", () => {
    const config = quickReplyConfig({
      QUICK_REPLY_ENABLED: "0",
      QUICK_REPLY_MODEL: "openrouter/google/gemini-3.8-flash",
      QUICK_REPLY_REASONING: "MINIMAL",
      QUICK_REPLY_TIMEOUT_MS: "5",
      QUICK_REPLY_DEBOUNCE_MS: "abc",
      QUICK_REPLY_POLL_MS: "999999",
      QUICK_REPLY_MAX_CHARS: "120",
      QUICK_REPLY_PREFIX: "none",
    });
    expect(config).toMatchObject({
      enabled: false,
      model: { provider: "openrouter", modelId: "google/gemini-3.8-flash" },
      reasoning: "minimal",
      timeoutMs: 1000,
      debounceMs: 1500,
      pollMs: 60_000,
      maxChars: 120,
      prefix: "",
    });
    expect(quickReplyConfig({ QUICK_REPLY_REASONING: "turbo" }).reasoning).toBe("low");
  });

  it("parses provider/model and rejects half values", () => {
    expect(parseQuickReplyModel("google/gemini-3.8-flash")).toEqual({
      provider: "google",
      modelId: "gemini-3.8-flash",
    });
    expect(parseQuickReplyModel("gemini-3.8-flash")).toBeUndefined();
    expect(parseQuickReplyModel("google/")).toBeUndefined();
    expect(parseQuickReplyModel(" ")).toBeUndefined();
  });
});

describe("quickReplyEligible", () => {
  const config = quickReplyConfig({});
  it("runs for conversational user turns only", () => {
    const base = { scripted: false, messageUserDisabled: false, config };
    expect(quickReplyEligible({ ...base, trigger: "user" })).toBe(true);
    expect(quickReplyEligible({ ...base, trigger: "follow_up" })).toBe(true);
    for (const trigger of [
      "routine",
      "webhook",
      "tickets",
      "created",
      "messaging",
      "bot_message",
    ]) {
      expect(quickReplyEligible({ ...base, trigger })).toBe(false);
    }
  });

  it("is off when message_user is disabled, the run is scripted, or the env says so", () => {
    expect(
      quickReplyEligible({ trigger: "user", scripted: false, messageUserDisabled: true, config }),
    ).toBe(false);
    expect(
      quickReplyEligible({ trigger: "user", scripted: true, messageUserDisabled: false, config }),
    ).toBe(false);
    expect(
      quickReplyEligible({
        trigger: "user",
        scripted: false,
        messageUserDisabled: false,
        config: quickReplyConfig({ QUICK_REPLY_ENABLED: "off" }),
      }),
    ).toBe(false);
  });
});

describe("buildQuickReplyPrompt", () => {
  it("carries persona, plan, recent activity, elapsed time and the messages", () => {
    const { instructions, prompt } = buildQuickReplyPrompt(context(), [
      "a che punto sei?",
      "e il <PDF>?",
    ]);
    expect(instructions).toContain("cannot run tools");
    expect(instructions).toContain("same language as the user's message");
    expect(instructions).toContain("must not: claim any result");
    expect(prompt).toContain("name: Ricercatore");
    expect(prompt).toContain("elapsed_since_start: 3m 5s");
    expect(prompt).toContain("progress: 1/3");
    expect(prompt).toContain("2. [in_progress] Scrivere l'HTML");
    expect(prompt).toContain("20s ago: Running shell: chromium --headless");
    expect(prompt).toContain("Ho raccolto 12 fonti.");
    expect(prompt).toContain("a che punto sei?\n---\ne il &lt;PDF&gt;?");
  });

  it("marks a completed plan as belonging to an earlier request, and handles no plan", () => {
    const completed = buildQuickReplyPrompt(
      context({ plan: { ...context().plan!, status: "completed" } }),
      ["ciao"],
    ).prompt;
    expect(completed).toContain("belongs to an earlier request");
    const none = buildQuickReplyPrompt(context({ plan: null, recentActivity: [] }), ["ciao"]);
    expect(none.prompt).toContain("<plan>\nnone\n</plan>");
    expect(none.prompt).toContain("none yet");
  });
});

describe("sanitizeQuickReply", () => {
  it("keeps a short plain reply", () => {
    expect(sanitizeQuickReply("  Ricevuto, lo considero al prossimo passo.  ", 300)).toBe(
      "Ricevuto, lo considero al prossimo passo.",
    );
  });

  it("drops thinking, markdown and quotes", () => {
    expect(sanitizeQuickReply("<think>hmm</think>**Ok**, sono al\n\npasso 2.", 300)).toBe(
      "Ok, sono al passo 2.",
    );
    expect(sanitizeQuickReply("«Sto generando il PDF.»", 300)).toBe("Sto generando il PDF.");
  });

  it("refuses failures, silence markers and tool-shaped output", () => {
    expect(sanitizeQuickReply("", 300)).toBeUndefined();
    expect(sanitizeQuickReply("I hit a problem: quota", 300)).toBeUndefined();
    expect(sanitizeQuickReply("NO_RESPONSE", 300)).toBeUndefined();
    expect(sanitizeQuickReply('<tool_call>{"name":"shell"}</tool_call>', 300)).toBeUndefined();
    expect(sanitizeQuickReply("```bash\nls\n```", 300)).toBeUndefined();
  });

  it("cuts long replies at a sentence", () => {
    const text = `${"Prima frase abbastanza lunga da contare. ".repeat(3)}Seconda parte che sfora il limite di caratteri.`;
    const out = sanitizeQuickReply(text, 100);
    expect(out!.length).toBeLessThanOrEqual(100);
    expect(out!.endsWith(".")).toBe(true);
  });
});

describe("frameQuickAckedSteering", () => {
  it("tells the main run the ack is already out", () => {
    const framed = frameQuickAckedSteering(
      "fermati dopo il PDF",
      "Ok, lo passo al lavoro in corso.",
    );
    expect(framed).toContain("already posted");
    expect(framed).toContain("Ok, lo passo al lavoro in corso.");
    expect(framed).toContain("Do not acknowledge the message again");
    expect(framed.endsWith("fermati dopo il PDF")).toBe(true);
    expect(framed.startsWith(QUICK_ACKED_STEERING_NOTE.slice(0, 40))).toBe(true);
    expect(framed).not.toContain("follow-up");
  });

  it("asks for at most one clarification, only when needed, when follow-ups are on", () => {
    const framed = frameQuickAckedSteering("a che punto sei?", "Sono al passo 2 di 3.", {
      followUp: true,
    });
    expect(framed.startsWith(QUICK_ACKED_FOLLOWUP_NOTE.slice(0, 40))).toBe(true);
    expect(framed).toContain("«Sono al passo 2 di 3.»");
    expect(framed).toContain("Only if it was wrong");
    expect(framed).toContain("exactly one short follow-up with the message_user tool");
    expect(framed).toContain("in your very next step");
    expect(framed).toContain("in the user's language");
    expect(framed).toContain("never start it with ⚡");
    expect(framed).toContain("If the reply was accurate and enough, send nothing about it");
    expect(framed).toContain("Never send more than one follow-up");
    expect(framed).toContain("continue the original task with tool calls");
    expect(framed.endsWith("\n\na che punto sei?")).toBe(true);
  });

  it("keeps the ack literal ($ patterns, guillemets)", () => {
    const framed = frameQuickAckedSteering("ok", "costa $& e $1 «circa»", { followUp: true });
    expect(framed).toContain('«costa $& e $1 "circa"»');
  });
});

describe("createQuickReplyCoordinator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one reply for a burst of messages", async () => {
    const send = vi.fn(async (items: QuickReplyItem[]) => `ok ${items.length}`);
    const coordinator = createQuickReplyCoordinator({ debounceMs: 1000, send });
    coordinator.observe([item(1)]);
    await vi.advanceTimersByTimeAsync(500);
    coordinator.observe([item(2)]);
    await vi.advanceTimersByTimeAsync(500);
    coordinator.observe([item(3), item(1)]);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].map((entry) => entry.messageId)).toEqual(["m-1", "m-2", "m-3"]);
    const acks = await coordinator.settle([item(1), item(3)]);
    expect([...acks]).toEqual([
      ["m-1", "ok 3"],
      ["m-3", "ok 3"],
    ]);
  });

  it("caps how long a burst can keep extending the window", async () => {
    const send = vi.fn(async () => "ok");
    const coordinator = createQuickReplyCoordinator({
      debounceMs: 1000,
      maxBatchWaitMs: 2000,
      send,
    });
    for (let n = 1; n <= 5; n += 1) {
      coordinator.observe([item(n)]);
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("settle dispatches a message still waiting in the window and waits for it", async () => {
    const send = vi.fn(async () => "Ricevuto.");
    const coordinator = createQuickReplyCoordinator({ debounceMs: 5000, send });
    coordinator.observe([item(1)]);
    const acks = await coordinator.settle([item(1), item(2)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(acks.get("m-1")).toBe("Ricevuto.");
    expect(acks.get("m-2")).toBe("Ricevuto.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns no ack when the call fails, so the main run acknowledges", async () => {
    const coordinator = createQuickReplyCoordinator({
      debounceMs: 0,
      send: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    const acks = await coordinator.settle([item(1)]);
    expect(acks.size).toBe(0);
    const empty = createQuickReplyCoordinator({
      debounceMs: 0,
      send: vi.fn(async () => undefined),
    });
    expect((await empty.settle([item(1)])).size).toBe(0);
  });

  it("never replies to ignored (initial) messages and nothing after stop", async () => {
    const send = vi.fn(async () => "ok");
    const coordinator = createQuickReplyCoordinator({ debounceMs: 100, send });
    coordinator.ignore(["m-1"]);
    coordinator.observe([item(1)]);
    await vi.advanceTimersByTimeAsync(500);
    expect(send).not.toHaveBeenCalled();
    coordinator.observe([item(2)]);
    coordinator.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(send).not.toHaveBeenCalled();
    expect((await coordinator.settle([item(2)])).size).toBe(0);
  });

  it("queues a second burst behind a reply in flight", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi
      .fn<(items: QuickReplyItem[]) => Promise<string>>()
      .mockImplementationOnce(async () => {
        await first;
        return "uno";
      })
      .mockImplementationOnce(async () => "due");
    const coordinator = createQuickReplyCoordinator({ debounceMs: 0, send });
    coordinator.observe([item(1)]);
    await vi.advanceTimersByTimeAsync(1);
    coordinator.observe([item(2)]);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    const settled = coordinator.settle([item(2)]);
    release();
    expect((await settled).get("m-2")).toBe("due");
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("startRunQuickReply", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function deps(overrides: Partial<Parameters<typeof startRunQuickReply>[0]> = {}) {
    const published: string[] = [];
    const pending: QuickReplyItem[] = [];
    const base: Parameters<typeof startRunQuickReply>[0] = {
      config: quickReplyConfig({ QUICK_REPLY_DEBOUNCE_MS: "200", QUICK_REPLY_POLL_MS: "500" }),
      pollSteering: vi.fn(async () => pending.splice(0)),
      resolveModel: vi.fn(async () => MODEL),
      loadContext: vi.fn(async () => context()),
      generate: vi.fn(async () => "Sono al passo 2 di 3, lo considero subito dopo."),
      publish: vi.fn(async (text: string) => {
        published.push(text);
        return true;
      }),
      ...overrides,
    };
    return { base, published, pending };
  }

  it("polls while a tool runs, replies once, and hands the ack to the claim", async () => {
    const { base, published, pending } = deps();
    const quick = startRunQuickReply(base);
    quick.arm([]);
    pending.push(item(1, "a che punto sei?"));
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(250);
    expect(published).toEqual(["⚡ Sono al passo 2 di 3, lo considero subito dopo."]);
    const generate = base.generate as ReturnType<typeof vi.fn>;
    expect(generate).toHaveBeenCalledTimes(1);
    const [model, prompt] = generate.mock.calls[0]!;
    expect(model).toBe(MODEL);
    expect(prompt.prompt).toContain("a che punto sei?");
    const acks = await quick.settle([item(1, "a che punto sei?")]);
    expect(acks.get("m-1")).toBe("Sono al passo 2 di 3, lo considero subito dopo.");
    quick.stop();
  });

  it("does not poll before the first claim, and ignores the initial messages", async () => {
    const { base, published } = deps();
    const quick = startRunQuickReply(base);
    await vi.advanceTimersByTimeAsync(2000);
    expect(base.pollSteering).not.toHaveBeenCalled();
    expect((await quick.settle([item(1)])).size).toBe(0);
    quick.arm(["m-1"]);
    expect((await quick.settle([item(1)])).size).toBe(0);
    expect(published).toEqual([]);
    quick.stop();
  });

  it("falls back silently when the model call times out", async () => {
    const { base, published } = deps({
      config: quickReplyConfig({ QUICK_REPLY_TIMEOUT_MS: "1000", QUICK_REPLY_DEBOUNCE_MS: "0" }),
      generate: vi.fn(() => new Promise<string | undefined>(() => undefined)),
    });
    const quick = startRunQuickReply(base);
    quick.arm([]);
    const settled = quick.settle([item(1)]);
    await vi.advanceTimersByTimeAsync(1100);
    expect((await settled).size).toBe(0);
    expect(published).toEqual([]);
    quick.stop();
  });

  it("disables itself for the run when no model can be resolved", async () => {
    const { base, published } = deps({
      resolveModel: vi.fn(async () => {
        throw new Error("Connect that model provider first");
      }),
    });
    const quick = startRunQuickReply(base);
    quick.arm([]);
    expect((await quick.settle([item(1)])).size).toBe(0);
    expect((await quick.settle([item(2)])).size).toBe(0);
    expect(base.resolveModel).toHaveBeenCalledTimes(1);
    expect(base.generate).not.toHaveBeenCalled();
    expect(published).toEqual([]);
    quick.stop();
  });

  it("reports no ack when the run is no longer ours to post in", async () => {
    const { base } = deps({ publish: vi.fn(async () => false) });
    const quick = startRunQuickReply(base);
    quick.arm([]);
    expect((await quick.settle([item(1)])).size).toBe(0);
    quick.stop();
  });

  it("stops polling after stop", async () => {
    const { base } = deps();
    const quick = startRunQuickReply(base);
    quick.arm([]);
    await vi.advanceTimersByTimeAsync(1000);
    const calls = (base.pollSteering as ReturnType<typeof vi.fn>).mock.calls.length;
    quick.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect((base.pollSteering as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });
});

describe("withQuickReplyTexts", () => {
  it("looks up the posted reply by message id, not by steering row id (regression)", () => {
    // settle() returns messageId -> text; the steering row id (s-1) must not be used.
    const replies = new Map([["m-1", "Ricevuto, lo passo al lavoro in corso."]]);
    const out = withQuickReplyTexts(
      [
        { id: "s-1", messageId: "m-1", text: "a che punto sei?" },
        { id: "s-2", messageId: "m-2", text: "altro" },
      ],
      replies,
    );
    expect(out[0]!.quickReplyText).toBe("Ricevuto, lo passo al lavoro in corso.");
    expect(out[1]!.quickReplyText).toBeUndefined();
    expect(out[0]!.id).toBe("s-1");
  });

  it("marks follow-up only on items that got a quick reply, and only when enabled", () => {
    const replies = new Map([["m-1", "Ricevuto."]]);
    const items = [
      { id: "s-1", messageId: "m-1", text: "a" },
      { id: "s-2", messageId: "m-2", text: "b" },
    ];
    const on = withQuickReplyTexts(items, replies, { followUp: true });
    expect(on[0]!.quickReplyFollowUp).toBe(true);
    expect(on[1]!.quickReplyFollowUp).toBeUndefined();
    const off = withQuickReplyTexts(items, replies, { followUp: false });
    expect(off[0]!.quickReplyFollowUp).toBeUndefined();
    expect(withQuickReplyTexts(items, replies)[0]!.quickReplyFollowUp).toBeUndefined();
  });

  it("feeds settle() results straight into the claim (end to end)", async () => {
    const quick = startRunQuickReply({
      config: quickReplyConfig({ QUICK_REPLY_DEBOUNCE_MS: "0" }),
      pollSteering: vi.fn(async () => []),
      resolveModel: vi.fn(async () => MODEL),
      loadContext: vi.fn(async () => context()),
      generate: vi.fn(async () => "Sono al passo 2 di 3."),
      publish: vi.fn(async () => true),
      logFailure: vi.fn(),
    });
    quick.arm([]);
    const claimed = [{ id: "s-7", messageId: "m-7", text: "a che punto sei?" }];
    const framed = withQuickReplyTexts(claimed, await quick.settle(claimed));
    expect(framed[0]!.quickReplyText).toBe("Sono al passo 2 di 3.");
    quick.stop();
  });
});

describe("quick reply failure logging", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function start(overrides: Partial<Parameters<typeof startRunQuickReply>[0]>) {
    const logs: QuickReplyFailureLog[] = [];
    const quick = startRunQuickReply({
      config: quickReplyConfig({ QUICK_REPLY_TIMEOUT_MS: "1000", QUICK_REPLY_DEBOUNCE_MS: "0" }),
      runId: "run-42",
      pollSteering: vi.fn(async () => []),
      resolveModel: vi.fn(async () => MODEL),
      loadContext: vi.fn(async () => context()),
      generate: vi.fn(async () => "Sono al passo 2 di 3, scrivo l'HTML."),
      publish: vi.fn(async () => true),
      logFailure: (fields) => logs.push(fields),
      logPosted: vi.fn(),
      ...overrides,
    });
    quick.arm([]);
    return { quick, logs };
  }

  it("logs a timeout with run id, elapsed ms and model, never the content", async () => {
    const { quick, logs } = start({
      generate: vi.fn(() => new Promise<string | undefined>(() => undefined)),
    });
    const settled = quick.settle([item(1, "testo segreto dell'utente")]);
    await vi.advanceTimersByTimeAsync(1100);
    expect((await settled).size).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      runId: "run-42",
      reason: "timeout",
      timeoutMs: 1000,
      model: "google/gemini-3.8-flash",
      messages: 1,
    });
    expect(logs[0]!.elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(JSON.stringify(logs)).not.toContain("segreto");
    quick.stop();
  });

  it("logs an empty answer and posts the status fallback", async () => {
    const { quick, logs } = start({ generate: vi.fn(async () => undefined) });
    expect((await quick.settle([item(1)])).get("m-1")).toContain("Sono al passo 2/3");
    expect(logs.map((entry) => entry.reason)).toEqual(["empty_answer"]);
    expect(logs[0]!.fallback).toBe(true);
    quick.stop();
  });

  it("logs a rejected (tool-shaped) answer", async () => {
    const { quick, logs } = start({ generate: vi.fn(async () => "```json\n{}\n```") });
    expect((await quick.settle([item(1)])).get("m-1")).toContain("Sono al passo 2/3");
    expect(logs.map((entry) => entry.reason)).toEqual(["rejected_answer"]);
    quick.stop();
  });

  it("logs an error with the error class only", async () => {
    const { quick, logs } = start({
      generate: vi.fn(async () => {
        throw new TypeError("https://secret.example/v1 key=abc");
      }),
    });
    expect((await quick.settle([item(1)])).get("m-1")).toContain("Sono al passo 2/3");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ reason: "error", errorName: "TypeError", fallback: true });
    expect(JSON.stringify(logs)).not.toContain("secret.example");
    quick.stop();
  });

  it("logs an unavailable model once", async () => {
    const { quick, logs } = start({ resolveModel: vi.fn(async () => undefined) });
    expect((await quick.settle([item(1)])).size).toBe(0);
    expect((await quick.settle([item(2)])).size).toBe(0);
    expect(logs.map((entry) => entry.reason)).toEqual(["model_unavailable"]);
    expect(logs[0]!.model).toBeUndefined();
    quick.stop();
  });

  it("logs a reply that could not be published", async () => {
    const { quick, logs } = start({ publish: vi.fn(async () => false) });
    expect((await quick.settle([item(1)])).size).toBe(0);
    expect(logs.map((entry) => entry.reason)).toEqual(["not_published"]);
    quick.stop();
  });

  it("logs nothing on success", async () => {
    const { quick, logs } = start({});
    expect((await quick.settle([item(1)])).get("m-1")).toBe("Sono al passo 2 di 3, scrivo l'HTML.");
    expect(logs).toEqual([]);
    quick.stop();
  });
});

describe("smart reply with status fallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function start(overrides: Partial<Parameters<typeof startRunQuickReply>[0]>) {
    const logs: QuickReplyFailureLog[] = [];
    const posted: QuickReplyPostedLog[] = [];
    const published: string[] = [];
    const quick = startRunQuickReply({
      config: quickReplyConfig({
        QUICK_REPLY_TIMEOUT_MS: "1000",
        QUICK_REPLY_SMART_MS: "600",
        QUICK_REPLY_DEBOUNCE_MS: "0",
      }),
      runId: "run-7",
      pollSteering: vi.fn(async () => []),
      resolveModel: vi.fn(async () => MODEL),
      loadContext: vi.fn(async () => context()),
      generate: vi.fn(async () => "Sono al passo 2 di 3, scrivo l'HTML."),
      publish: vi.fn(async (text: string) => {
        published.push(text);
        return true;
      }),
      logFailure: (fields) => logs.push(fields),
      logPosted: (fields) => posted.push(fields),
      ...overrides,
    });
    quick.arm([]);
    return { quick, logs, posted, published };
  }

  it("posts a specific status line when the model is slower than the smart budget", async () => {
    const { quick, logs, posted, published } = start({
      generate: vi.fn(() => new Promise<string | undefined>(() => undefined)),
    });
    const settled = quick.settle([item(1, "a che punto sei?")]);
    await vi.advanceTimersByTimeAsync(700);
    const text = (await settled).get("m-1");
    expect(text).toBe(
      "Sono al passo 2/3 «Scrivere l'HTML» (piano al 33%), al lavoro da 3m 5s; ultima operazione: Running shell: chromium --headless (20s fa). Leggo il tuo messaggio appena finisce l'operazione in corso e ti rispondo nel merito.",
    );
    expect(published).toEqual([`⚡ ${text}`]);
    expect(logs).toMatchObject([{ reason: "timeout", fallback: true }]);
    expect(posted).toMatchObject([{ runId: "run-7", source: "fallback" }]);
    quick.stop();
  });

  it("replaces a bare acknowledgement with the status line", async () => {
    const { quick, logs, posted } = start({
      generate: vi.fn(async () => "Ricevuto, poi vedo!"),
    });
    const text = (await quick.settle([item(1, "hai visto il file?")])).get("m-1");
    expect(text).toContain("Sono al passo 2/3");
    expect(logs).toMatchObject([{ reason: "filler_answer", fallback: true }]);
    expect(posted[0]!.source).toBe("fallback");
    quick.stop();
  });

  it("logs a posted model reply with its timing, not its text", async () => {
    const { quick, posted } = start({});
    await quick.settle([item(1, "testo privato")]);
    expect(posted).toMatchObject([
      { runId: "run-7", source: "model", model: "google/gemini-3.8-flash", messages: 1 },
    ]);
    expect(JSON.stringify(posted)).not.toContain("privato");
    quick.stop();
  });

  it("posts nothing when even the context cannot load in time", async () => {
    const { quick, published } = start({
      loadContext: vi.fn(() => new Promise<QuickReplyContext>(() => undefined)),
    });
    const settled = quick.settle([item(1)]);
    await vi.advanceTimersByTimeAsync(1100);
    expect((await settled).size).toBe(0);
    expect(published).toEqual([]);
    quick.stop();
  });
});

describe("buildQuickReplyPrompt (status context)", () => {
  it("carries plan percent, current step, notes, continuation and the recent conversation", () => {
    const base = context();
    const { instructions, prompt } = buildQuickReplyPrompt(
      context({
        plan: {
          ...base.plan!,
          steps: base.plan!.steps.map((step) =>
            step.index === 2 ? { ...step, notes: "pagina indice fatta" } : step,
          ),
        },
        continuation: { index: 3, max: 10, percent: 55 },
        recentMessages: [
          { role: "user", text: "Fammi un sito sulle fonti" },
          { role: "bot", text: "Parto dalla raccolta fonti." },
        ],
      }),
      ["a che punto sei?"],
    );
    expect(instructions).toContain("ricevuto, poi vedo");
    expect(instructions).toContain("never invent facts");
    expect(prompt).toContain("(33%)");
    expect(prompt).toContain("current_step: 2");
    expect(prompt).toContain("pagina indice fatta");
    expect(prompt).toContain("automatic_continuation: 3/10 (last reported 55%)");
    expect(prompt).toContain("<recent_conversation>");
    expect(prompt).toContain("Fammi un sito sulle fonti");
  });

  it("caps the recent conversation", () => {
    const long = "x".repeat(2000);
    const { prompt } = buildQuickReplyPrompt(
      context({
        recentMessages: Array.from({ length: 12 }, (_, i) => ({
          role: i % 2 ? ("bot" as const) : ("user" as const),
          text: `${i} ${long}`,
        })),
      }),
      ["ok?"],
    );
    const block = prompt.split("<recent_conversation>")[1]!.split("</recent_conversation>")[0]!;
    expect(block.length).toBeLessThanOrEqual(1600);
  });
});

describe("isFillerQuickReply", () => {
  it.each([
    "Ricevuto, poi vedo.",
    "⚡ Ok, ne terrò conto!",
    "Messaggio ricevuto, ti aggiorno a breve.",
    "Got it, will check.",
    "Noted, thanks!",
    "Perfetto, lo considero al prossimo passaggio.",
  ])("flags %j", (text) => expect(isFillerQuickReply(text)).toBe(true));

  it.each([
    "Sono al passo 2 di 3, scrivo l'HTML.",
    "Ricevuto: aggiungo il PDF dopo il passo 3 «Tavole».",
    "Parigi è la capitale della Francia.",
    "Got it, I'll switch the chart to euros after the current step.",
    "62%",
  ])("keeps %j", (text) => expect(isFillerQuickReply(text)).toBe(false));
});

describe("buildFallbackQuickReply", () => {
  it("answers in English for an English message, with continuation", () => {
    const text = buildFallbackQuickReply(
      context({ continuation: { index: 2, max: 5, percent: 40 } }),
      ["what's the status?"],
    );
    expect(text).toBe(
      "I'm on step 2/3 \"Scrivere l'HTML\" (plan 33% done), working for 3m 5s; automatic continuation 2/5; last step: Running shell: chromium --headless (20s ago). I'll read your message as soon as the current operation ends and answer it properly.",
    );
  });

  it("works without a plan or activity", () => {
    const text = buildFallbackQuickReply(context({ plan: null, recentActivity: [] }), [
      "ci sei ancora?",
    ]);
    expect(text).toBe(
      "Sto ancora lavorando alla richiesta in corso, da 3m 5s. Leggo il tuo messaggio appena finisce l'operazione in corso e ti rispondo nel merito.",
    );
  });

  it("stays within the character cap", () => {
    expect(
      buildFallbackQuickReply(context(), ["a che punto sei?"], 300).length,
    ).toBeLessThanOrEqual(300);
  });
});

describe("callQuickReplyModel", () => {
  function runtime(events: AgentRuntimeEvent[], spy?: (request: unknown) => void): AgentRuntime {
    return {
      describe: () => ({
        id: "fake",
        contractVersion: "1",
        adapterVersion: "0",
        capabilities: { streaming: true, compaction: false, tools: false, scripted: false },
      }),
      abort: async () => undefined,
      run: (request) => {
        spy?.(request);
        return (async function* () {
          for (const event of events) yield event;
        })();
      },
    } as AgentRuntime;
  }

  const input = {
    model: { ...MODEL, thinkingLevel: "low" as const },
    instructions: "be quick",
    prompt: "hi",
    runId: "run-1",
    botId: "b",
    threadId: "t",
    spaceId: "s",
    userId: "u",
    timeoutMs: 5000,
  };

  it("runs without tools or history and returns the final text", async () => {
    let seen:
      | { tools: unknown[]; history: unknown[]; runId: string; model: AgentRunModel }
      | undefined;
    const text = await callQuickReplyModel({
      ...input,
      runtime: runtime(
        [
          { type: "text", text: "Ricevuto" },
          { type: "done", text: "Ricevuto, ci penso al prossimo passo." },
        ] as AgentRuntimeEvent[],
        (request) => {
          seen = request as typeof seen;
        },
      ),
    });
    expect(text).toBe("Ricevuto, ci penso al prossimo passo.");
    expect(seen?.tools).toEqual([]);
    expect(seen?.history).toEqual([]);
    expect(seen?.runId.startsWith("run-1:quick-reply:")).toBe(true);
    expect(seen?.model.thinkingLevel).toBe("low");
  });

  it("returns undefined for provider failures and thrown errors", async () => {
    expect(
      await callQuickReplyModel({
        ...input,
        runtime: runtime([{ type: "text", text: "I hit a problem: 429" }] as AgentRuntimeEvent[]),
      }),
    ).toBeUndefined();
    const broken = runtime([]);
    broken.run = () => {
      throw new Error("offline");
    };
    expect(await callQuickReplyModel({ ...input, runtime: broken })).toBeUndefined();
  });
});
