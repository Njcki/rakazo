import { describe, expect, it } from "vitest";
import { mcpBearerAuthorization } from "./mcp-connector.js";

describe("mcpBearerAuthorization", () => {
  it("returns undefined for empty values", () => {
    expect(mcpBearerAuthorization(undefined)).toBeUndefined();
    expect(mcpBearerAuthorization("")).toBeUndefined();
    expect(mcpBearerAuthorization("   ")).toBeUndefined();
  });

  it("prefixes a raw PAT with Bearer", () => {
    expect(mcpBearerAuthorization("ghp_example")).toBe("Bearer ghp_example");
  });

  it("normalizes an existing Bearer or token prefix", () => {
    expect(mcpBearerAuthorization("Bearer ghp_example")).toBe("Bearer ghp_example");
    expect(mcpBearerAuthorization("bearer ghp_example")).toBe("Bearer ghp_example");
    expect(mcpBearerAuthorization("token ghp_example")).toBe("Bearer ghp_example");
  });
});
