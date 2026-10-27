import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock("expo-file-system/legacy", () => ({ getContentUriAsync: vi.fn() }));
vi.mock("expo-sharing", () => ({}));
vi.mock("react-native", () => ({ Image: {}, Platform: { OS: "android" } }));
vi.mock("./api", () => ({}));
vi.mock("./artifact-cache-session", () => ({}));
vi.mock("./i18n", () => ({ t: (s: string) => s }));
vi.mock("./session", () => ({}));

const { APK_MIME_TYPE, intentMimeType } = await import("./artifact-open");

describe("intentMimeType", () => {
  it("sends an .apk as a package archive even when it arrived as octet-stream", () => {
    expect(intentMimeType("application/octet-stream", "rakazo.apk")).toBe(APK_MIME_TYPE);
    expect(intentMimeType("", "App.APK")).toBe(APK_MIME_TYPE);
  });

  it("keeps known types and opens generic ones for any app", () => {
    expect(intentMimeType("application/pdf; charset=binary", "a.pdf")).toBe("application/pdf");
    expect(intentMimeType("application/octet-stream", "data.bin")).toBe("*/*");
  });
});
