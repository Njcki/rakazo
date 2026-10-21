import { describe, expect, it } from "vitest";
import {
  observeTranscriptContent,
  transcriptCanSnapAfterFrame,
  transcriptIsNearEnd,
  transcriptLatestChange,
  transcriptMovedDown,
  transcriptShouldSnap,
} from "./transcript-scroll.js";

describe("transcriptIsNearEnd", () => {
  it("follows only while the viewport is within 100px of the latest message", () => {
    expect(transcriptIsNearEnd({ scrollHeight: 1_000, scrollTop: 401, clientHeight: 500 })).toBe(
      true,
    );
    expect(transcriptIsNearEnd({ scrollHeight: 1_000, scrollTop: 400, clientHeight: 500 })).toBe(
      false,
    );
  });
});

describe("transcriptCanSnapAfterFrame", () => {
  it("does not snap after the reader moves while the frame is queued", () => {
    const transcript = { scrollTop: 950 };
    expect(transcriptCanSnapAfterFrame(transcript, transcript, 950)).toBe(true);
    transcript.scrollTop = 920;
    expect(transcriptCanSnapAfterFrame(transcript, transcript, 950)).toBe(false);
  });

  it("does not snap a replacement transcript", () => {
    const queuedTranscript = { scrollTop: 950 };
    const replacementTranscript = { scrollTop: 950 };
    expect(transcriptCanSnapAfterFrame(replacementTranscript, queuedTranscript, 950)).toBe(false);
  });
});

describe("transcriptMovedDown", () => {
  it("does not treat an uninitialized baseline as downward movement", () => {
    expect(transcriptMovedDown(null, 920)).toBe(false);
    expect(transcriptMovedDown(950, 920)).toBe(false);
    expect(transcriptMovedDown(920, 950)).toBe(true);
  });
});

describe("transcriptShouldSnap", () => {
  const base = { following: true, pointerHeld: false, jumpScrolling: false, autoScrolling: false };
  it("pins the end only while following and nothing else owns the viewport", () => {
    expect(transcriptShouldSnap(base)).toBe(true);
    expect(transcriptShouldSnap({ ...base, following: false })).toBe(false);
    expect(transcriptShouldSnap({ ...base, pointerHeld: true })).toBe(false);
    expect(transcriptShouldSnap({ ...base, jumpScrolling: true })).toBe(false);
    expect(transcriptShouldSnap({ ...base, autoScrolling: true })).toBe(false);
  });
});

describe("transcriptLatestChange", () => {
  it("separates the reader's own send from incoming messages", () => {
    expect(transcriptLatestChange(null, undefined)).toBe("none");
    expect(transcriptLatestChange(null, { id: "a", role: "assistant" })).toBe("initial");
    expect(transcriptLatestChange("a", { id: "a", role: "assistant" })).toBe("none");
    expect(transcriptLatestChange("a", { id: "b", role: "user" })).toBe("own");
    expect(transcriptLatestChange("b", { id: "c", role: "assistant" })).toBe("incoming");
  });
});

describe("observeTranscriptContent", () => {
  it("observes the viewport, existing rows and rows mounted later", () => {
    const observed: unknown[] = [];
    let resize: () => void = () => {};
    let mutate: () => void = () => {};
    let disconnected = 0;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {
        disconnected += 1;
      }
    }
    class FakeMutationObserver {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect() {
        disconnected += 1;
      }
    }
    const rowA = { id: "a" };
    const rowB = { id: "b" };
    const element = { children: [rowA] } as unknown as HTMLElement;
    let calls = 0;
    const stop = observeTranscriptContent(
      element,
      () => {
        calls += 1;
      },
      { ResizeObserver: FakeResizeObserver, MutationObserver: FakeMutationObserver },
    );
    expect(observed).toEqual([element, rowA]);
    resize();
    expect(calls).toBe(1);
    (element as unknown as { children: unknown[] }).children = [rowA, rowB];
    mutate();
    expect(observed).toEqual([element, rowA, rowB]);
    expect(calls).toBe(2);
    stop();
    expect(disconnected).toBe(2);
  });

  it("is a no-op without ResizeObserver", () => {
    const stop = observeTranscriptContent({ children: [] } as unknown as HTMLElement, () => {}, {});
    expect(() => stop()).not.toThrow();
  });
});
