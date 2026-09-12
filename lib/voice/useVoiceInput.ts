"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSttProvider, type SttProvider } from "@/lib/stt/provider";
import { recordTiming } from "@/lib/voice/timing";

/**
 * Voice input half of the loop (ROADMAP.md Phase 1A's `useVoiceInput`).
 * Owns capture through the swappable STT provider (lib/stt/provider.ts)
 * and reports how long the leg took, so the roadmap's ~2s budget is
 * measured rather than assumed.
 *
 * Push-to-talk only, by design: `start()` must be called from a real
 * pointer-down handler and `stop()` from pointer-up. There is no
 * toggle mode and no VAD — an always-listening mic in a children's app
 * is a product decision nobody has made, and hold-to-talk is the
 * mental model a 6-year-old already has from every walkie-talkie toy.
 *
 * The TTS half stays in lib/speech/useSpeech.ts, unchanged — this hook
 * deliberately does not wrap or replace it. ExerciseScreen composes the
 * two (plus useTalkingPose for mouth-sync).
 */
export type VoiceInputState = "idle" | "listening";

export function useVoiceInput(opts: {
  onTranscript: (transcript: string) => void;
  /** Fired when capture ended with nothing usable heard — drives the
   *  roadmap's "מה? לא שמעתי, אפשר שוב?" re-ask path. */
  onNothingHeard?: () => void;
  /** Fired with the provider's raw error reason (lib/stt/provider.ts —
   *  e.g. "not-allowed", "no-speech", "network") whenever capture ends via
   *  an error, ALONGSIDE onEnd's usual onNothingHeard call (a permission
   *  refusal is also "nothing heard"; this is the extra signal for a
   *  caller that wants to say something more specific than the generic
   *  re-ask for that case). */
  onError?: (reason: string) => void;
  disabled?: boolean;
}) {
  const { onTranscript, onNothingHeard, onError, disabled } = opts;

  const [state, setState] = useState<VoiceInputState>("idle");
  const [available, setAvailable] = useState(false);

  const providerRef = useRef<SttProvider | null>(null);
  const sessionRef = useRef<{ stop(): void } | null>(null);
  const startedAtRef = useRef<number>(0);
  const gotResultRef = useRef(false);

  // Latest-callback refs: the provider session captures these once at
  // start(), and a re-render mid-utterance would otherwise leave it
  // calling a stale closure over the previous exercise.
  const onTranscriptRef = useRef(onTranscript);
  const onNothingHeardRef = useRef(onNothingHeard);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onNothingHeardRef.current = onNothingHeard;
    onErrorRef.current = onError;
  }, [onTranscript, onNothingHeard, onError]);

  useEffect(() => {
    const provider = getSttProvider();
    providerRef.current = provider;
    setAvailable(provider.isAvailable());
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    const provider = providerRef.current;
    if (!provider || !provider.isAvailable()) return;
    if (sessionRef.current) return; // already capturing

    gotResultRef.current = false;
    startedAtRef.current = performance.now();

    sessionRef.current = provider.start({
      onResult: (transcript) => {
        gotResultRef.current = true;
        recordTiming("listen", performance.now() - startedAtRef.current);
        onTranscriptRef.current(transcript);
      },
      onEnd: () => {
        sessionRef.current = null;
        setState("idle");
        if (!gotResultRef.current) onNothingHeardRef.current?.();
      },
      onError: (reason) => {
        // The session still ends via onEnd (which fires onNothingHeard) —
        // this is the extra, more specific signal for callers that want to
        // distinguish e.g. a blocked microphone from silence.
        onErrorRef.current?.(reason);
      },
    });

    setState("listening");
  }, [disabled]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  // Safety net: a component unmounting mid-utterance (kid taps back to
  // the map while holding the mic) must not leave the recognizer running.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  return { state, available, start, stop };
}
