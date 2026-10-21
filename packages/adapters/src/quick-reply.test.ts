import type { AgentRunModel, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQuickReplyPrompt,
  callQuickReplyModel,
  createQuickReplyCoordinator,
  frameQuickAckedSteering,
  parseQuickReplyModel,
  type QuickReplyContext,
  type QuickReplyItem,
  quickReplyConfig,
  quickReplyEligible,
  sanitizeQuickReply,
  startRunQuickReply,
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

describe("quickReplyConfig", () => {
  it("defaults on with low reasoning and the backup model", () => {
    const config = quickReplyConfig({});
    expect(config).toMatchObject({
      enabled: true,
      model: undefined,
      reasoning: "low",
      timeoutMs: 8000,
      debounceMs: 1500,
      pollMs: 1500,
      maxChars: 300,
      prefix: "⚡ ",
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
