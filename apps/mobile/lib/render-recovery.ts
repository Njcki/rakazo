import type * as FileSystemModule from "expo-file-system";

/**
 * Recovery from a render failure: retry delays and a small on-device log of what failed.
 *
 * A render error in the chat used to replace the whole app with a "Try again" screen. Most of
 * these are transient (a live update that arrives mid-render), so the screen now remounts on its
 * own after a short, growing delay and keeps the last failures so they can be copied and reported.
 */

/** Delays before each automatic retry, in ms; the last one repeats. */
export const RENDER_RETRY_DELAYS_MS = [0, 400, 1_000, 2_500, 5_000, 10_000] as const;

/** Failures older than this no longer count towards the backoff. */
export const RENDER_FAILURE_WINDOW_MS = 60_000;

/** Failures within the window after which the inline notice offers a manual retry. */
export const RENDER_FAILURES_BEFORE_NOTICE = 3;

export function renderRetryDelay(recentFailures: number): number {
  const index = Math.max(0, Math.min(recentFailures - 1, RENDER_RETRY_DELAYS_MS.length - 1));
  return RENDER_RETRY_DELAYS_MS[index] ?? 10_000;
}

/** Keeps only the failure times inside the window ending at `now`, plus `now`. */
export function noteRenderFailure(times: readonly number[], now: number): number[] {
  return [...times.filter((time) => now - time < RENDER_FAILURE_WINDOW_MS), now];
}

export type RenderFailure = {
  at: string;
  scope: string;
  message: string;
  stack?: string;
  componentStack?: string;
};

const MAX_FAILURES = 10;
const MAX_STACK = 1_500;
let failures: RenderFailure[] = [];

type FailureStorage = { read(): string | null; write(value: string): void };
let storage: FailureStorage | null | undefined;

function failureStorage(): FailureStorage | null {
  if (storage !== undefined) return storage;
  try {
    // Loaded lazily so tests and early startup never need the native module.
    const { File, Paths } = require("expo-file-system") as typeof FileSystemModule;
    const file = new File(Paths.document, "render-failures.json");
    storage = {
      read: () => (file.exists ? file.textSync() : null),
      write: (value) => file.write(value),
    };
  } catch {
    storage = null;
  }
  return storage;
}

/** Replaces the storage, for tests. */
export function setRenderFailureStorage(next: FailureStorage | null) {
  storage = next;
  failures = [];
}

function loadFailures(): RenderFailure[] {
  if (failures.length > 0) return failures;
  try {
    const raw = failureStorage()?.read();
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) failures = parsed.slice(-MAX_FAILURES) as RenderFailure[];
  } catch {
    failures = [];
  }
  return failures;
}

export function recordRenderFailure(
  scope: string,
  error: unknown,
  componentStack?: string | null,
  now = new Date(),
): RenderFailure {
  const entry: RenderFailure = {
    at: now.toISOString(),
    scope,
    message:
      error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "unknown"),
    ...(error instanceof Error && error.stack ? { stack: error.stack.slice(0, MAX_STACK) } : {}),
    ...(componentStack ? { componentStack: componentStack.trim().slice(0, MAX_STACK) } : {}),
  };
  failures = [...loadFailures(), entry].slice(-MAX_FAILURES);
  try {
    failureStorage()?.write(JSON.stringify(failures));
  } catch {
    // The log is a diagnostic aid; losing it must never break recovery.
  }
  return entry;
}

export function recentRenderFailures(): readonly RenderFailure[] {
  return loadFailures();
}

/** Plain-text report of the recent failures, for the clipboard. */
export function renderFailureReport(appVersion?: string): string {
  const lines = [`Rakazo render failures${appVersion ? ` (app ${appVersion})` : ""}`];
  for (const failure of loadFailures()) {
    lines.push("", `${failure.at} [${failure.scope}] ${failure.message}`);
    if (failure.componentStack) lines.push(failure.componentStack);
    if (failure.stack) lines.push(failure.stack);
  }
  return lines.join("\n");
}
