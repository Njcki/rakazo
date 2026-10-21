import type { ThreadScrollState } from "@rakazo/core";

export type { ThreadScrollState } from "@rakazo/core";

export type ThreadScrollAction = "jump" | "smooth" | null;

/** Within this distance of the latest message the reader counts as "at the bottom" and follows. */
export const THREAD_FOLLOW_THRESHOLD_PX = 100;

/**
 * maintainVisibleContentPosition for the inverted live thread. Keeping the newest row in place
 * is right for a reader who scrolled up, but at the bottom it pushes a new message, the working
 * indicator or a failed-send bubble just below the screen; autoscrollToTopThreshold makes the
 * native side scroll back to offset 0 (the latest message) when the reader was within the
 * follow threshold, before JS sees the change.
 */
export const LIVE_THREAD_LIST_POSITION = {
  minIndexForVisible: 0,
  autoscrollToTopThreshold: THREAD_FOLLOW_THRESHOLD_PX,
} as const;

/** The pinned (non-inverted) history page: offset 0 is the oldest row, so never autoscroll. */
export const PINNED_PAGE_LIST_POSITION = { minIndexForVisible: 0 } as const;

export class ThreadScrollBehavior {
  private threadKey: string | null = null;
  private laidOut = false;
  private contentReady = false;
  private latestMessageId: string | null = null;
  private currentState: ThreadScrollState = { detached: false, unread: false };

  openThread(threadKey: string): void {
    if (this.threadKey === threadKey) return;
    this.threadKey = threadKey;
    this.laidOut = false;
    this.contentReady = false;
    this.latestMessageId = null;
    this.currentState = { detached: false, unread: false };
  }

  onLayout(): ThreadScrollAction {
    this.laidOut = true;
    return this.contentReady && !this.currentState.detached ? "jump" : null;
  }

  onContentChanged(blocked: boolean, latestMessageId: string | null): ThreadScrollAction {
    if (blocked) return null;
    this.contentReady = true;
    if (latestMessageId === null || latestMessageId === this.latestMessageId) return null;
    const initial = this.latestMessageId === null;
    this.latestMessageId = latestMessageId;
    if (initial) return this.laidOut ? "jump" : null;
    if (this.currentState.detached) {
      this.currentState = { detached: true, unread: true };
      return null;
    }
    return "smooth";
  }

  onUserScroll(distanceFromEnd: number): ThreadScrollState {
    const detached = distanceFromEnd > THREAD_FOLLOW_THRESHOLD_PX;
    this.currentState = {
      detached,
      unread: detached ? this.currentState.unread : false,
    };
    return this.state();
  }

  jumpToLatest(): ThreadScrollAction {
    this.currentState = { detached: false, unread: false };
    return "smooth";
  }

  state(): ThreadScrollState {
    return { ...this.currentState };
  }
}
