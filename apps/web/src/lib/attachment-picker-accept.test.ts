import { describe, expect, it } from "vitest";
import { attachmentPickerAccept } from "./attachment-picker-accept.js";

describe("attachmentPickerAccept", () => {
  it("lets Android document providers offer every file", () => {
    expect(attachmentPickerAccept("Mozilla/5.0 (Linux; Android 17; Pixel 7 Pro) Mobile")).toBe(
      "*/*",
    );
  });

  it("RAKAZO: does not filter file types on desktop either", () => {
    expect(attachmentPickerAccept("Mozilla/5.0 (X11; Linux x86_64) Chrome/140")).toBe("*/*");
  });
});
