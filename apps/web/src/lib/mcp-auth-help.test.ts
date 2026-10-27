import { describe, expect, it } from "vitest";
import { matchMcpAuthProvider } from "./mcp-auth-help";

describe("matchMcpAuthProvider", () => {
  it("matches GitHub MCP endpoint", () => {
    expect(matchMcpAuthProvider("https://api.githubcopilot.com/mcp/")?.id).toBe("github");
  });

  it("matches Canva by host", () => {
    expect(matchMcpAuthProvider("https://mcp.canva.com/mcp")?.id).toBe("canva");
  });

  it("matches provider name token without false positives", () => {
    expect(matchMcpAuthProvider("GitHub")?.id).toBe("github");
    expect(matchMcpAuthProvider("sandbox")).toBeNull();
    expect(matchMcpAuthProvider("dropbox")).toBeNull();
  });

  it("returns null for unknown hosts", () => {
    expect(matchMcpAuthProvider("https://example.com/mcp")).toBeNull();
    expect(matchMcpAuthProvider("")).toBeNull();
    expect(matchMcpAuthProvider(null)).toBeNull();
  });
});
