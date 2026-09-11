"use client";

import { useEffect, useRef, useState } from "react";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MapNode, { type NodeState } from "@/components/map/MapNode";
import { getTopics } from "@/lib/map/topics";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import type { CharacterId, CharacterPose } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";
import type { RecentAttempt } from "@/lib/dashboard/types";

interface Props {
  character: CharacterId;
  kidName: string;
  grade: Grade;
  recentAttempts: RecentAttempt[];
  /** False until /api/kids has answered — the character thinks meanwhile
   *  instead of standing on a stop that's about to move. */
  loaded: boolean;
  /** `wasDone` tells the exercise screen whether a correct answer here
   *  completes the topic for the first time (a tier-2 moment) or is a
   *  replay of a stop already walked. */
  onPickTopic: (subject: Subject, topicId: string, wasDone: boolean) => void;
}

const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "math", label: "חשבון" },
  { value: "hebrew", label: "עברית" },
];

const OWNER = "map";

// Geometry, in px. Physical coordinates: SVG has no RTL, and the zigzag
// is symmetric, so reading direction doesn't change the drawing.
const W = 340;
const NODE = 76;
const NODE_CURRENT = 86;
const ROW = 128; // centre-to-centre between ordinary stops
const STAGE = 170; // extra room above the guide's stop, for its bubble
const PAD_TOP = 40;
const PAD_BOTTOM = 72;
const OFFSETS = [0, 68, -68];
const GUIDE_H = 132; // the character, standing at its stop
const GUIDE_W = Math.round(GUIDE_H * 0.8);
const GUIDE_GAP = 8;
/** Bubble bottom sits this far above the guide's stop centre — clear of
 *  the character's head. */
const BUBBLE_LIFT = GUIDE_H - NODE / 2 - 6 + 14;

interface Pt {
  x: number;
  y: number;
}

/** Point + heading on the trail's cubic between two stops (control points
 *  at the vertical midpoint, which is what gives the path its S-curves). */
function trailAt(p: Pt, q: Pt, t: number) {
  const ym = (p.y + q.y) / 2;
  const mt = 1 - t;
  const x = mt ** 3 * p.x + 3 * mt * mt * t * p.x + 3 * mt * t * t * q.x + t ** 3 * q.x;
  const y = mt ** 3 * p.y + 3 * mt * mt * t * ym + 3 * mt * t * t * ym + t ** 3 * q.y;
  const dx = 6 * mt * t * (q.x - p.x);
  const dy = 3 * mt * mt * (ym - p.y) + 3 * t * t * (q.y - ym);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * The map, led by the character (character-led redesign, Task 5 item 2).
 *
 * The character stands at the kid's current stop, full-size and talking —
 * not a 64px thumbnail beside it — and says where we are, by name.
 *
 * Decision B (locked): the art has no pointing pose, so the character
 * stands in `idle` and DIRECTION IS CARRIED BY THE PATH:
 * - walked trail up to the current stop: solid teal;
 * - the stretch ahead, current → next: a highlighted band with a dash
 *   that flows forward and three chevrons marching toward the next stop;
 * - the rest: dotted gray, not yet walked;
 * - the current stop pings, and bounces when the kid taps a locked one.
 * The `encouraging` pose is deliberately never used here — it's the
 * wrong-answer pose, and using it for navigation would teach a kid it
 * means "you did something wrong" on every map visit.
 *
 * The character reacts to the state of the path: first stop → an
 * invitation; mid-path → "here's our next stop"; every stop done → it
 * stands on the last one in `celebration`; a locked tap → it redirects
 * (still `idle`, talking). Tapping the character repeats its line.
 *
 * Stop completion is still derived from `recentAttempts` (the dashboard
 * payload's recent-activity slice, not full history) — a topic completed
 * long enough ago to fall out of that window will show as not-done again.
 * Known approximation from the UI revamp, unchanged here.
 */
export default function ProgressMap({ character, kidName, grade, recentAttempts, loaded, onPickTopic }: Props) {
  const [subject, setSubject] = useState<Subject>("math");
  const [override, setOverride] = useState<Line | null>(null);
  const [attention, setAttention] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const topics = getTopics(subject, grade);
  const doneIds = new Set(
    recentAttempts.filter((a) => a.correct).map((a) => topics.find((t) => t.topic === a.topic)?.id).filter(Boolean)
  );

  let currentAssigned = false;
  const states: NodeState[] = topics.map((t) => {
    if (doneIds.has(t.id)) return "done";
    if (!currentAssigned) {
      currentAssigned = true;
      return "current";
    }
    return "locked";
  });
  const currentIndex = states.indexOf("current");
  const allDone = topics.length > 0 && currentIndex === -1;
  // Where the character stands: the current stop, or the last one once
  // every stop is walked.
  const stageIndex = allDone ? topics.length - 1 : currentIndex;

  // ---- What the character says and does ----
  const otherLabel = SUBJECTS.find((s) => s.value !== subject)!.label;
  const autoLine: Line | null = !loaded
    ? null
    : topics.length === 0
      ? lines.mapEmpty(kidName, otherLabel)
      : allDone
        ? lines.mapAllDone(kidName)
        : doneIds.size === 0
          ? lines.mapFirst(kidName)
          : lines.mapNext(kidName);
  const line = override ?? autoLine;
  const basePose: CharacterPose = !loaded || topics.length === 0 ? "thinking" : allDone ? "celebration" : "idle";
  const guide = useGuide({
    owner: OWNER,
    character,
    pose: basePose,
    line,
    // Speak on arrival, and again whenever the stop or subject changes —
    // not when a locked-tap override swaps the words (that's said
    // directly in the tap handler).
    cue: loaded ? `${subject}:${stageIndex}:${topics.length}` : null,
  });

  useEffect(() => {
    stageRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [subject, loaded, stageIndex]);

  function switchSubject(next: Subject) {
    if (next === subject) return;
    setOverride(null);
    setSubject(next);
  }

  function onLockedTap() {
    const l = lines.mapLocked(kidName);
    setOverride(l);
    guide.say(l); // synchronous in the tap — iOS gesture rule
    setAttention((n) => n + 1);
  }

  // ---- Layout ----
  const pts: Pt[] = [];
  let y = PAD_TOP + NODE / 2;
  topics.forEach((_, i) => {
    if (i === stageIndex) y += STAGE;
    pts.push({ x: W / 2 + OFFSETS[i % 3], y });
    y += ROW;
  });
  const height = (pts.at(-1)?.y ?? 0) + NODE / 2 + PAD_BOTTOM;

  const segments = pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1];
    const kind: "walked" | "ahead" | "locked" =
      states[i] === "current" ? "ahead" : states[i] === "done" && states[i + 1] !== "locked" ? "walked" : "locked";
    const ym = (p.y + q.y) / 2;
    return { key: i, kind, p, q, d: `M ${p.x} ${p.y} C ${p.x} ${ym}, ${q.x} ${ym}, ${q.x} ${q.y}` };
  });

  const stage = stageIndex >= 0 ? pts[stageIndex] : null;
  const guideOnLeft = stage ? stage.x > W / 2 : false;
  const guideLeft = stage
    ? guideOnLeft
      ? stage.x - NODE_CURRENT / 2 - GUIDE_GAP - GUIDE_W
      : stage.x + NODE_CURRENT / 2 + GUIDE_GAP
    : 0;
  const guideCenterX = guideLeft + GUIDE_W / 2;

  const subjectTabs = (
    <div className="flex justify-center gap-2 py-3">
      {SUBJECTS.map((s) => (
        <button
          key={s.value}
          onClick={() => switchSubject(s.value)}
          className={`min-h-11 px-6 rounded-[var(--radius-button)] text-base font-medium transition ${
            subject === s.value ? "bg-[var(--color-teal)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink-soft)]"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  // Loading and empty: the character alone, centred, thinking.
  if (!loaded || topics.length === 0) {
    return (
      <div className="flex flex-col flex-1">
        {subjectTabs}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 pb-10">
          <Character character={character} pose={guide.pose} size={200} />
          {line && (
            <SpeechBubble
              key={lines.spoken(line)}
              text={line.text}
              lead={line.name}
              tail="top"
              tailAlign="center"
              owner={OWNER} character={character}
              className="w-full max-w-sm"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {subjectTabs}
      <div className="flex-1 overflow-y-auto">
        <div className="relative mx-auto" style={{ width: W, height }}>
          <svg aria-hidden width={W} height={height} className="absolute inset-0 overflow-visible">
            {segments.map((s) =>
              s.kind === "walked" ? (
                <path key={s.key} d={s.d} fill="none" stroke="var(--color-teal)" strokeWidth={12} strokeLinecap="round" />
              ) : s.kind === "locked" ? (
                <path
                  key={s.key}
                  d={s.d}
                  fill="none"
                  stroke="var(--color-trail-locked)"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeDasharray="1 16"
                />
              ) : (
                <g key={s.key}>
                  <path d={s.d} fill="none" stroke="var(--color-teal-soft)" strokeWidth={22} strokeLinecap="round" />
                  <path
                    d={s.d}
                    fill="none"
                    stroke="var(--color-teal)"
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray="14 18"
                    className="animate-trail"
                  />
                  {[0.36, 0.55, 0.74].map((t, n) => {
                    const c = trailAt(s.p, s.q, t);
                    return (
                      <g key={t} transform={`translate(${c.x} ${c.y}) rotate(${c.angle})`}>
                        <g className="animate-chevron" style={{ animationDelay: `${n * 0.22}s` }}>
                          <circle r={12} fill="var(--color-surface)" stroke="var(--color-teal)" strokeWidth={2} />
                          <path
                            d="M -4 -6 L 3 0 L -4 6"
                            fill="none"
                            stroke="var(--color-teal-ink)"
                            strokeWidth={3.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </g>
                      </g>
                    );
                  })}
                </g>
              )
            )}
          </svg>

          {topics.map((t, i) => {
            const size = i === currentIndex ? NODE_CURRENT : NODE;
            return (
              <div key={t.id} className="absolute" style={{ left: pts[i].x - size / 2, top: pts[i].y - size / 2 }}>
                <MapNode
                  topic={t.topic}
                  state={states[i]}
                  size={size}
                  attention={i === currentIndex ? attention : 0}
                  onTap={() => {
                    if (states[i] === "locked") onLockedTap();
                    else onPickTopic(subject, t.id, states[i] === "done");
                  }}
                />
              </div>
            );
          })}

          {stage && line && (
            <>
              <div ref={stageRef} aria-hidden className="absolute w-px h-px" style={{ left: stage.x, top: stage.y - 70 }} />
              <div
                className="absolute"
                style={{ left: 4, width: W - 8, top: stage.y - BUBBLE_LIFT, transform: "translateY(-100%)" }}
              >
                <SpeechBubble
                  key={lines.spoken(line)}
                  text={line.text}
                  lead={line.name}
                  size="md"
                  tail="bottom"
                  tailX={guideCenterX - 4}
                  owner={OWNER} character={character}
                />
              </div>
              <button
                type="button"
                onClick={() => line && guide.say(line)}
                aria-label="להקשיב שוב"
                className="absolute"
                style={{ left: guideLeft, top: stage.y + NODE / 2 + 6 - GUIDE_H }}
              >
                <Character character={character} pose={guide.pose} size={GUIDE_H} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
