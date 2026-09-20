"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  audioDebugEnabled,
  getAudioPathLog,
  isIOSWebKit,
  mseStreamingAllowed,
  readAudioEnv,
  subscribeAudioPathLog,
  type AudioPathEntry,
} from "@/lib/speech/audioPath";

const NO_ENTRIES: readonly AudioPathEntry[] = [];

/**
 * TEMPORARY (2026-09-20 hotfix) — remove once the iPhone silence question
 * is answered, together with audioDebugEnabled() in lib/speech/audioPath.ts.
 *
 * A one-line-per-event strip along the bottom of the screen, shown only
 * with `?audiodebug=1`. It mirrors the `[tts-path]` console trace, because
 * a phone has no devtools and "it's silent" is not a report anyone can act
 * on. What Asaf should read out from it:
 *   - the first line: whether the iOS gate fired on this device
 *   - the newest lines: which path a line took (mse / blob / speechSynthesis)
 *     and why (ios-webkit-gate, stall, http-502, play-rejected, ...)
 *   - any line starting "SILENT" means the chain ran out of voices.
 *
 * Nothing for a child ever sees this: it renders null unless the flag is set.
 */
export default function AudioDebugLine() {
  const entries = useSyncExternalStore(subscribeAudioPathLog, getAudioPathLog, () => NO_ENTRIES);
  // Read after mount: the flag lives in the URL / sessionStorage, neither of
  // which exists during the server render.
  const [on, setOn] = useState(false);
  useEffect(() => setOn(audioDebugEnabled()), []);

  if (!on) return null;

  const env = readAudioEnv();
  const header = `ios=${isIOSWebKit(env)} mseAllowed=${mseStreamingAllowed(env)} touch=${env.maxTouchPoints}`;
  const recent = entries.slice(-4).reverse();

  return (
    <div
      dir="ltr"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        pointerEvents: "none",
        background: "rgba(0,0,0,0.78)",
        color: "#7dff9a",
        font: "11px/1.35 ui-monospace, Menlo, monospace",
        padding: "4px 8px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <div>{`[audiodebug] ${header}`}</div>
      {recent.length === 0 ? (
        <div>no speak yet</div>
      ) : (
        recent.map((e) => (
          <div key={e.at + e.reason} style={{ color: e.reason.startsWith("SILENT") ? "#ff7d7d" : undefined }}>
            {`${new Date(e.at).toLocaleTimeString([], { hour12: false })} ${e.path} — ${e.reason}`}
          </div>
        ))
      )}
    </div>
  );
}
