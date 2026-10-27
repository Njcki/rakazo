import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * Hands-free call audio on Android: communication mode, so the microphone records through the
 * voice-communication path with the platform echo canceller. The bot's voice coming out of the
 * speaker is cancelled instead of being transcribed as the caller, and the caller can still
 * interrupt it. Elsewhere, or on a build without the module, every call is a no-op.
 */
type CallAudioModule = {
  enter(): boolean;
  reassert(): boolean;
  leave(): boolean;
};

let native: CallAudioModule | null | undefined;

function module(): CallAudioModule | null {
  if (native === undefined) {
    native =
      Platform.OS === "android"
        ? requireOptionalNativeModule<CallAudioModule>("RakazoCallAudio")
        : null;
  }
  return native;
}

let inCall = false;

function run(action: (mod: CallAudioModule) => boolean): void {
  const mod = module();
  if (!mod) return;
  try {
    action(mod);
  } catch {
    // Audio routing is best effort; the echo filter on transcripts still applies.
  }
}

export function enterCallAudio(): void {
  inCall = true;
  run((mod) => mod.enter());
}

/** Call after anything that sets the audio mode, which drops communication mode on Android. */
export function reassertCallAudio(): void {
  if (inCall) run((mod) => mod.reassert());
}

export function leaveCallAudio(): void {
  if (!inCall) return;
  inCall = false;
  run((mod) => mod.leave());
}

export function callAudioActive(): boolean {
  return inCall;
}
