"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSttProvider, type SttProvider, type SttSession } from "@/lib/stt/provider";
import { stopSpeaking } from "@/lib/speech/useSpeech";
import { playHeardCue } from "@/lib/speech/cue";
import { markEndOfSpeech, recordTiming } from "@/lib/voice/timing";

/**
 * Voice input half of the loop (ROADMAP.md Phase 1A's `useVoiceInput`).
 * Owns capture through the swappable STT provider (lib/stt/provider.ts —
 * cloud recognition with the browser engine as fallback) and reports how
 * long each leg took, so the roadmap's ~2s budget is measured rather than
 * assumed.
 *
 * Push-to-talk only, by design: `start()` must be called from a real
 * pointer-down handler and `stop()` from pointer-up. There is no
 * toggle mode and no VAD — an always-listening mic in a children's app
 * is a product decision nobody has made, and hold-to-talk is the
 * mental model a 6-year-old already has from every walkie-talkie toy.
 *
 * The TTS half stays in lib/speech/useSpeech.ts — this hook doesn't wrap
 * it; it only calls stopSpeaking() on press (barge-in, see start()).
 * ExerciseScreen composes the two (plus useTalkingPose for mouth-sync).
 *
 * States: idle -> listening (finger down) -> processing (released; the
 * cloud engine is uploading and transcribing) -> idle.
 */
export type VoiceInputState = "idle" | "listening" | "processing";

export function useVoiceInput(opts: {
  onTranscript: (transcript: string) => void;
  /** Fired when capture ended with nothing usable heard — drives the
   *  roadmap's "מה? לא שמעתי, אפשר שוב?" re-ask path. */
  onNothingHeard?: () => void;
  /** Fired with the provider's raw error reason (lib/stt/provider.ts —
   *  e.g. "not-allowed", "no-speech", "cloud-failed") whenever capture
   *  ends via an error, ALONGSIDE onEnd's usual onNothingHeard call (a
   *  permission refusal is also "nothing heard"; this is the extra signal
   *  for a caller that wants to say something more specific than the
   *  generic re-ask for that case). */
  onError?: (reason: string) => void;
  disabled?: boolean;
}) {
  const { onTranscript, onNothingHeard, onError, disabled } = opts;

  const [state, setState] = useState<VoiceInputState>("idle");
  const [available, setAvailable] = useState(false);

  const providerRef = useRef<SttProvider | null>(null);
  const sessionRef = useRef<SttSession | null>(null);
  const startedAtRef = useRef<number>(0);
  const releasedAtRef = useRef<number | null>(null);
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

    // Barge-in: cancel any line the character is saying — or has fetched
    // and is about to start playing (MicButton is only disabled once audio
    // is actually playing). Its sound would otherwise land in the
    // recording and be transcribed as the kid's answer.
    stopSpeaking();

    gotResultRef.current = false;
    startedAtRef.current = performance.now();
    releasedAtRef.current = null;
    setState("listening");

    // A provider can end synchronously inside start() (engine unavailable)
    // — track that locally so a dead session never gets stored in
    // sessionRef, where it would block every later press ("already
    // capturing").
    let ended = false;
    const session = provider.start({
      onResult: (transcript) => {
        gotResultRef.current = true;
        const now = performance.now();
        recordTiming("listen", now - startedAtRef.current);
        if (releasedAtRef.current !== null) recordTiming("transcribe", now - releasedAtRef.current);
        onTranscriptRef.current(transcript);
      },
      onEnd: () => {
        ended = true;
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
      onCaptureEnd: () => {
        releasedAtRef.current = performance.now();
        // Push-to-talk: release IS end-of-speech. Everything downstream is
        // measured from here.
        markEndOfSpeech();
        // The "I heard you" cue, before anything network-bound. The spoken
        // acknowledgement still follows (ExerciseScreen's prefetched
        // thinking line, unchanged) — but that one costs a round trip, and
        // this is the moment the child is actually waiting through.
        playHeardCue();
        recordTiming("cue", performance.now() - releasedAtRef.current);
        setState((s) => (s === "listening" ? "processing" : s));
      },
    });
    if (!ended) sessionRef.current = session;
  }, [disabled]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  // Safety net: a component unmounting mid-utterance (kid taps back to
  // the map while holding the mic, or while a clip is uploading) must not
  // leave the recognizer running or deliver a transcript to a screen
  // that's gone.
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session?.cancel) session.cancel();
      else session?.stop();
      sessionRef.current = null;
    };
  }, []);

  return { state, available, start, stop };
}
