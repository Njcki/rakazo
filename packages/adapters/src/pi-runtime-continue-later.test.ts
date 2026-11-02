import { once } from "node:events";
import { createServer } from "node:http";
import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { expect, it } from "vitest";
import { PiAgentRuntime } from "./pi-runtime.js";

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id: "fixture",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

const continueCall = chunk(
  {
    role: "assistant",
    tool_calls: [
      {
        index: 0,
        id: "cl-1",
        type: "function",
        function: {
          name: "continue_later",
          arguments: '{"summary":"Doppiati 3 capitoli su 10.","percent":30}',
        },
      },
    ],
  },
  "tool_calls",
);

async function runWith(result: Record<string, unknown>) {
  let calls = 0;
  const server = createServer((request, response) => {
    request.resume();
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    calls += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const body =
      calls === 1
        ? chunk({ role: "assistant", content: "Lavoro in corso." }) + continueCall
        : chunk(
            { role: "assistant", content: "Mi fermo qui: completati 3 capitoli su 10." },
            "stop",
          );
    response.end(`${body}data: [DONE]\n\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture endpoint unavailable");
  const executed: string[] = [];
  const events: AgentRuntimeEvent[] = [];
  try {
    for await (const event of new PiAgentRuntime().run(
      {
        botId: "fixture-bot",
        threadId: "fixture-thread",
        runId: "fixture-run",
        prompt: "Doppia il libro.",
        instructions: "Fixture",
        history: [],
        tools: [
          {
            name: "continue_later",
            description: "Continue later",
            inputSchema: {
              type: "object",
              properties: { summary: { type: "string" }, percent: { type: "integer" } },
              required: ["summary"],
            },
          },
        ],
        executeTool: async (name: string) => {
          executed.push(name);
          return result;
        },
        model: {
          provider: "openai-compatible",
          id: "fixture",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          allowPrivateEndpoint: true,
        },
      },
      { signal: AbortSignal.timeout(15_000) },
    )) {
      events.push(event);
    }
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
  const texts = events.flatMap((event) =>
    event.type === "text" ? [event.text] : event.type === "turn" ? ["<turn>"] : [],
  );
  return { calls, executed, texts };
}

it("an accepted continue_later ends the run at once with the summary as the reply", async () => {
  const { calls, executed, texts } = await runWith({
    ok: true,
    continueLater: "accepted",
    summary: "Doppiati 3 capitoli su 10.",
  });
  expect(executed).toEqual(["continue_later"]);
  expect(calls).toBe(1);
  expect(texts.join("")).toContain("Doppiati 3 capitoli su 10.");
});

it("a refused continue_later lets the model write a real final answer", async () => {
  const { calls, texts } = await runWith({
    error: "Automatic continuation limit reached. Write your final answer now.",
  });
  expect(calls).toBe(2);
  expect(texts.join("")).toContain("Mi fermo qui");
});
