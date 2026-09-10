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
  disabled?: boolean;
}) {
  const { onTranscript, onNothingHeard, disabled } = opts;

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
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onNothingHeardRef.current = onNothingHeard;
  }, [onTranscript, onNothingHeard]);

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
      onError: () => {
        // Errors end the session via onEnd; nothing-heard handling there
        // covers the "kid held the button but said nothing" case too.
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
