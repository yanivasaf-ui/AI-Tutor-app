"use client";

import { isAutoSpeakOn } from "@/lib/speech/autoSpeak";

/**
 * feat: streaming voice pipeline — the "I heard you" cue.
 *
 * The moment the child lets go of the mic, something has to answer them.
 * Until now the only audible acknowledgement was the character saying
 * "רגע, אני חושב..." — a real TTS line, which means a network round trip
 * (measured: ~495ms Cartesia TTFB on top of the niqqud call before it).
 * The reassurance meant to cover the wait was itself stuck behind the
 * wait. A child who hears nothing assumes they weren't heard and starts
 * talking over the pending turn.
 *
 * This is a synthesised two-note blip: no network, no fetch, no cache, no
 * vendor. It plays within a frame of the finger lifting. It does NOT
 * replace the spoken acknowledgement — that still follows, prefetched,
 * exactly as before (the scripted-line path is untouched). This just gets
 * there first.
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

/**
 * Two short, soft notes — rising, because rising reads as "go on / got
 * it" rather than the falling pair every error sound in the world uses.
 * Quiet on purpose (peak gain 0.07): this is a nudge under the character's
 * voice, not a notification.
 *
 * Silent when auto-speak is off, same rule the character's own automatic
 * lines follow — a muted device stays muted.
 */
export function playHeardCue(): void {
  if (!isAutoSpeakOn()) return;
  const audio = getContext();
  if (!audio) return;
  // iOS suspends the context until a gesture; the mic press IS one, so
  // this resolves in time for the release that follows it.
  if (audio.state === "suspended") void audio.resume().catch(() => {});

  const now = audio.currentTime;
  const notes = [
    { freq: 660, at: 0, len: 0.09 },
    { freq: 880, at: 0.1, len: 0.12 },
  ];

  for (const note of notes) {
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      // Ramped, never a hard start/stop — a square edge on a sine is an
      // audible click, and this plays right next to a child's ear.
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.exponentialRampToValueAtTime(0.07, now + note.at + 0.02);
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
