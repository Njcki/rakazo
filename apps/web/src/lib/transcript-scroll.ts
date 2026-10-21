/** Within this many px of the end the transcript counts as "at the bottom" and follows new content. */
export const TRANSCRIPT_FOLLOW_THRESHOLD_PX = 100;

export function transcriptIsNearEnd(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight < TRANSCRIPT_FOLLOW_THRESHOLD_PX
  );
}

export function transcriptCanSnapAfterFrame(
  element: Pick<HTMLElement, "scrollTop"> | null,
  queuedElement: Pick<HTMLElement, "scrollTop">,
  queuedScrollTop: number,
): boolean {
  return element === queuedElement && queuedElement.scrollTop === queuedScrollTop;
}

export function transcriptMovedDown(previousScrollTop: number | null, scrollTop: number): boolean {
  return previousScrollTop !== null && scrollTop >= previousScrollTop;
}

export type TranscriptFollowFlags = {
  /** The reader is at (or near) the end and the transcript follows new content. */
  following: boolean;
  /** A pointer/touch is down in the transcript (text selection, drag, fling not settled). */
  pointerHeld: boolean;
  /** A jump-to-message scroll owns the viewport. */
  jumpScrolling: boolean;
  /** A smooth jump-to-latest animation is running. */
  autoScrolling: boolean;
};

/** Whether a content/viewport resize should re-pin the transcript to its end right now. */
export function transcriptShouldSnap(flags: TranscriptFollowFlags): boolean {
  return flags.following && !flags.pointerHeld && !flags.jumpScrolling && !flags.autoScrolling;
}

export type TranscriptLatestChange = "none" | "initial" | "own" | "incoming";

/**
 * Classify a change of the newest message: the user's own send always re-follows the end;
 * an incoming message while the reader is scrolled up only marks "new messages".
 */
export function transcriptLatestChange(
  previousLatestId: string | null,
  latest: { id: string; role: string } | undefined,
): TranscriptLatestChange {
  if (!latest || latest.id === previousLatestId) return "none";
  if (previousLatestId === null) return "initial";
  return latest.role === "user" ? "own" : "incoming";
}

type ResizeObserverLike = { observe(target: Element): void; disconnect(): void };
type MutationObserverLike = {
  observe(target: Node, options: MutationObserverInit): void;
  disconnect(): void;
};

/**
 * Call `onResize` whenever the transcript viewport or any of its rows changes size: streaming
 * text, images, charts and KaTeX that lay out after the commit. New rows are observed as they
 * mount. Returns a disconnect function; a no-op where ResizeObserver is unavailable.
 */
export function observeTranscriptContent(
  element: HTMLElement,
  onResize: () => void,
  deps: {
    ResizeObserver?: new (callback: () => void) => ResizeObserverLike;
    MutationObserver?: new (callback: () => void) => MutationObserverLike;
  } = {
    ResizeObserver: globalThis.ResizeObserver,
    MutationObserver: globalThis.MutationObserver,
  },
): () => void {
  const RO = deps.ResizeObserver;
  if (!RO) return () => {};
  const resize = new RO(onResize);
  const observed = new WeakSet<Element>();
  const observeChildren = () => {
    for (const child of Array.from(element.children)) {
      if (observed.has(child)) continue;
      observed.add(child);
      resize.observe(child);
    }
  };
  resize.observe(element);
  observeChildren();
  const MO = deps.MutationObserver;
  const mutations = MO
    ? new MO(() => {
        observeChildren();
        onResize();
      })
    : null;
  mutations?.observe(element, { childList: true });
  return () => {
    resize.disconnect();
    mutations?.disconnect();
  };
}
