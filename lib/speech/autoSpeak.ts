"use client";

import { useSyncExternalStore } from "react";
import { stopSpeaking } from "@/lib/speech/useSpeech";

/**
 * Auto-speak preference (ROADMAP.md Phase 1A: "wire it to auto-play on
 * tutor responses (with mute toggle)"). Per-device, not per-kid — it's a
 * "we're in a quiet room" setting, not a profile attribute.
 *
 * Moved out of ExerciseScreen for the character-led redesign: the
 * character now speaks on every screen (map, onboarding, parent gate,
 * celebrations), so the mute has to be one shared fact rather than a
 * setting that only the exercise screen honoured. Same localStorage key as
 * before, so a device that was muted stays muted.
 *
 * Only gates *automatic* speech. Tapping the 🔊 in a bubble is an
 * explicit request and always speaks.
 */
const AUTO_SPEAK_KEY = "ai-tutor-auto-speak";

let enabled: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === "undefined") return true;
  try {
    enabled = window.localStorage.getItem(AUTO_SPEAK_KEY) !== "off";
  } catch {
    enabled = true;
  }
  return enabled;
}

export function isAutoSpeakOn(): boolean {
  return read();
}

export function setAutoSpeak(next: boolean) {
  enabled = next;
  try {
    window.localStorage.setItem(AUTO_SPEAK_KEY, next ? "on" : "off");
  } catch {
    // storage blocked (private mode) — the in-memory value still applies
  }
  if (!next) stopSpeaking();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAutoSpeak(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  return [on, setAutoSpeak];
}
