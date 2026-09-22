import { describe, expect, it } from "vitest";

import { builtinAgentTools } from "./builtin-tools.js";
import {
  normalizeOpenAiToolParameters,
  openAiToolParametersNeedNormalization,
} from "./openai-tool-parameters.js";
import { parametersFor } from "./pi-runtime.js";

describe("normalizeOpenAiToolParameters", () => {
  it("fills properties for a zero-argument object schema", () => {
    expect(normalizeOpenAiToolParameters({ type: "object" })).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("keeps an empty properties map and does not invent parameters", () => {
    expect(normalizeOpenAiToolParameters({ type: "object", properties: {} })).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("flattens a root union, which Anthropic rejects, into one object schema", () => {
    const normalized = normalizeOpenAiToolParameters({
      anyOf: [
        {
          type: "object",
          properties: { label: { type: "string" }, a: { type: "string" } },
          required: ["label", "a"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { label: { type: "string" }, b: { type: "string" } },
          required: ["label", "b"],
          additionalProperties: false,
        },
      ],
    });
    expect(normalized).toEqual({
      type: "object",
      properties: { label: { type: "string" }, a: { type: "string" }, b: { type: "string" } },
      required: ["label"],
      additionalProperties: false,
    });
  });

  it("keeps every variant of a field that differs between root union branches", () => {
    const normalized = normalizeOpenAiToolParameters({
      oneOf: [
        { type: "object", properties: { action: { const: "start" } }, required: ["action"] },
        { type: "object", properties: { action: { const: "stop" } }, required: ["action"] },
      ],
    });
    expect(normalized).toEqual({
      type: "object",
      properties: { action: { anyOf: [{ const: "start" }, { const: "stop" }] } },
      required: ["action"],
    });
  });

  it("requires every field of a root allOf", () => {
    const normalized = normalizeOpenAiToolParameters({
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
      ],
    });
    expect(normalized.required).toEqual(["a", "b"]);
    expect(normalized.allOf).toBeUndefined();
  });

  it("intersects differing specs for the same field under a root allOf", () => {
    const normalized = normalizeOpenAiToolParameters({
      allOf: [
        { type: "object", properties: { n: { type: "integer", minimum: 0 } } },
        { type: "object", properties: { n: { type: "integer", maximum: 10 } } },
      ],
    });
    expect(normalized).toEqual({
      type: "object",
      properties: {
        n: {
          allOf: [
            { type: "integer", minimum: 0 },
            { type: "integer", maximum: 10 },
          ],
        },
      },
    });
  });

  it("preserves required, additionalProperties, and existing properties", () => {
    expect(
      normalizeOpenAiToolParameters({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    });
  });

  it("replaces a non-object type with object without inventing fields", () => {
    expect(normalizeOpenAiToolParameters({ type: "string" })).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("treats nullish or non-object input as an empty object schema", () => {
    expect(normalizeOpenAiToolParameters(undefined)).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeOpenAiToolParameters(null)).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeOpenAiToolParameters([])).toEqual({
      type: "object",
      properties: {},
    });
  });
});

describe("openAiToolParametersNeedNormalization", () => {
  it("returns false for a complete object schema", () => {
    expect(openAiToolParametersNeedNormalization({ type: "object", properties: {} })).toBe(false);
  });

  it("returns true when type or properties are missing or malformed", () => {
    expect(openAiToolParametersNeedNormalization({ type: "object" })).toBe(true);
    expect(openAiToolParametersNeedNormalization({ anyOf: [] })).toBe(true);
    expect(
      openAiToolParametersNeedNormalization({ type: "object", properties: {}, oneOf: [] }),
    ).toBe(true);
    expect(openAiToolParametersNeedNormalization({ type: "object", properties: [] })).toBe(true);
    expect(openAiToolParametersNeedNormalization({ type: "string", properties: {} })).toBe(true);
  });
});

describe("parametersFor OpenAI wire fidelity", () => {
  it("serializes zero-argument tools with type object and empty properties", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "list_secrets");
    if (!tool) throw new Error("missing list_secrets");
    const wire = JSON.parse(JSON.stringify(parametersFor(tool))) as {
      type?: unknown;
      properties?: unknown;
    };
    expect(wire.type).toBe("object");
    expect(wire.properties).toEqual({});
  });

  it("serializes request_secret as one object with both destinations and no root union", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "request_secret");
    if (!tool) throw new Error("missing request_secret");
    const wire = JSON.parse(JSON.stringify(parametersFor(tool))) as Record<string, unknown>;
    expect(wire.type).toBe("object");
    expect(Object.keys(wire.properties as object).sort()).toEqual([
      "connectionId",
      "credential",
      "label",
      "purpose",
      "replace",
    ]);
    expect(wire.required).toEqual(["label", "purpose"]);
    expect(wire.additionalProperties).toBe(false);
    for (const key of ["oneOf", "anyOf", "allOf"]) expect(wire).not.toHaveProperty(key);
  });

  it("never sends a root union for any builtin tool", () => {
    for (const tool of builtinAgentTools) {
      const wire = JSON.parse(JSON.stringify(parametersFor(tool))) as Record<string, unknown>;
      for (const key of ["oneOf", "anyOf", "allOf"]) {
        expect(wire, tool.name).not.toHaveProperty(key);
      }
    }
  });
});
