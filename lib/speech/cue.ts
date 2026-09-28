"use client";

import { isAutoSpeakOn } from "@/lib/speech/autoSpeak";

/**
 * feat: streaming voice pipeline — the "I heard you" cue. Kids-App UX
 * Benchmark, build-first item 2 — the "not quite" cue for a wrong answer.
 *
 * The moment the child lets go of the mic, something has to answer them.
 * Until now the only audible acknowledgement was the character saying
 * "רגע, אני חושב..." — a real TTS line, which means a network round trip
 * (measured: ~495ms Cartesia TTFB on top of the niqqud call before it).
 * The reassurance meant to cover the wait was itself stuck behind the
 * wait. A child who hears nothing assumes they weren't heard and starts
 * talking over the pending turn.
 *
 * Both cues below are synthesised two-note blips: no network, no fetch, no
 * cache, no vendor. `playHeardCue` plays within a frame of the finger
 * lifting; it does NOT replace the spoken acknowledgement — that still
 * follows, prefetched, exactly as before (the scripted-line path is
 * untouched). This just gets there first.
 *
 * Deliberately Web Audio and not an <audio> element: the shared element
 * (lib/speech/useSpeech.ts) is owned by the character's voice, and
 * borrowing it here would cut off whatever it is holding — including the
 * line the kid just barged in on.
 */

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

interface CueNote {
  freq: number;
  at: number;
  len: number;
}

/**
 * Plays `notes` as ramped sine tones starting at `audio.currentTime` —
 * shared by every cue below so the envelope shape (never a hard
 * start/stop; a square edge on a sine is an audible click, and these play
 * right next to a child's ear) lives in one place.
 */
function playNotes(audio: AudioContext, notes: readonly CueNote[], peakGain: number): void {
  const now = audio.currentTime;
  for (const note of notes) {
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.len);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + note.at);
      osc.stop(now + note.at + note.len + 0.02);
    } catch {
      // A blocked or closed context is not worth failing a turn over.
      return;
    }
  }
}

/** Two short, soft notes — rising, because rising reads as "go on / got
 *  it" rather than the falling pair every error sound in the world uses.
 *  Quiet on purpose (peak gain 0.07): this is a nudge under the
 *  character's voice, not a notification. Exported so its shape (rising,
 *  soft) is checkable without a browser. */
export const HEARD_CUE_NOTES: readonly CueNote[] = [
  { freq: 660, at: 0, len: 0.09 },
  { freq: 880, at: 0.1, len: 0.12 },
];
export const HEARD_CUE_PEAK_GAIN = 0.07;

/**
 * Silent when auto-speak is off, same rule the character's own automatic
 * lines follow — a muted device stays muted. This cue stands in for a
 * spoken line (see the module doc), so it follows the same mute rule that
 * line would.
 */
export function playHeardCue(): void {
  if (!isAutoSpeakOn()) return;
  const audio = getContext();
  if (!audio) return;
  // iOS suspends the context until a gesture; the mic press IS one, so
  // this resolves in time for the release that follows it.
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  playNotes(audio, HEARD_CUE_NOTES, HEARD_CUE_PEAK_GAIN);
}

/**
 * Two short, soft notes for a wrong answer — falling, the one interval
 * every ear reads as "not quite" (Khan Academy Kids' gentle "bong": never
 * a buzzer or alarm). Quieter than the heard-cue (peak gain 0.06): this
 * is the doctrine's "warm, never punitive" in a sound, sibling to the
 * existing correct-answer chime, not a penalty tone.
 *
 * Mute decision (Kids-App UX Benchmark item 2 — this app's SFX did not
 * consistently follow the auto-speak/mute toggle before this change, so
 * the behaviour had to be chosen explicitly rather than assumed):
 * lib/celebration/useCelebration.ts's existing "correct"/"celebrate"
 * chimes play on every right answer regardless of the mute toggle — mute
 * only silences the character's SPOKEN voice, not these short feedback
 * tones. This cue is that chime's direct counterpart (the wrong-answer
 * half of the same right/wrong feedback pair), so it follows the SAME
 * rule for symmetry: a muted device still gets an audible signal for
 * both right and wrong answers, just never the character's voice. Unlike
 * `playHeardCue` above (which stands in for a spoken line and so honours
 * the mute the way that line would), this one is deliberately NOT gated
 * on `isAutoSpeakOn()`.
 */
export const WRONG_CUE_NOTES: readonly CueNote[] = [
  { freq: 520, at: 0, len: 0.1 },
  { freq: 400, at: 0.11, len: 0.14 },
];
export const WRONG_CUE_PEAK_GAIN = 0.06;

export function playWrongCue(): void {
  const audio = getContext();
  if (!audio) return;
  // The child's tap on the (wrong) answer is the gesture; by then the
  // context is typically already resumed from an earlier interaction on
  // this screen, but resume defensively in case this is the very first
  // sound played this session.
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  playNotes(audio, WRONG_CUE_NOTES, WRONG_CUE_PEAK_GAIN);
}
