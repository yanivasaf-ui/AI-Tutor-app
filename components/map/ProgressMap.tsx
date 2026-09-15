"use client";

import { useEffect, useRef, useState } from "react";
import Character from "@/components/character/Character";
import SpeechBubble from "@/components/character/SpeechBubble";
import MapNode, { type NodeState } from "@/components/map/MapNode";
import { getTopics } from "@/lib/map/topics";
import { buildJourney, type Milestone } from "@/lib/practice/journey";
import { journeyDoneIds, type PracticeState } from "@/lib/practice/state";
import { useGuide } from "@/lib/guide/useGuide";
import * as lines from "@/lib/guide/lines";
import type { Line } from "@/lib/guide/lines";
import type { CharacterId, CharacterPose } from "@/lib/characters";
import type { Grade } from "@/lib/exercises/types";
import type { Subject } from "@/lib/memory/types";

interface Props {
  character: CharacterId;
  kidName: string;
  grade: Grade;
  /** Per-subject practice state — journey completion is read from here. */
  practice: Partial<Record<Subject, PracticeState>>;
  /** False until /api/kids has answered — the character thinks meanwhile
   *  instead of standing on a stop that's about to move. */
  loaded: boolean;
  /** `wasDone` tells the exercise screen whether a correct answer here
   *  completes the topic for the first time (a tier-2 moment) or is a
   *  replay of a stop already walked. */
  onPickTopic: (subject: Subject, topicId: string, wasDone: boolean) => void;
  /** Called once when a subject's map is shown with its one-time intro
   *  line, so the parent can record it. */
  onIntroSeen: (subject: Subject) => void;
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
const MILESTONE = 58; // a square turned 45°, so its diagonal is ~82
const ROW = 128; // centre-to-centre between ordinary stops
const STAGE = 196; // extra room above the guide's stop, for its bubble
// (170 -> 196, 2026-09-12: the topic-name eyebrow line added a row of
// text to the bubble, tall enough on the first stop to clip against the
// scroll container's top edge before this bump.)
const INTRO_EXTRA = 44; // the year-intro line is a sentence longer
const PAD_TOP = 40;
const PAD_BOTTOM = 72;
const OFFSETS = [0, 68, -68];
const GUIDE_H = 132; // the character, standing at its stop
const GUIDE_W = Math.round(GUIDE_H * 0.8);
const GUIDE_GAP = 8;
/** Bubble bottom sits this far above the guide's stop centre — clear of
 *  the character's head. */
const BUBBLE_LIFT = GUIDE_H - NODE / 2 - 6 + 14;
const SIDE_GAP = 6; // month / holiday label, beside its stop

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

/** A label beside a stop, on the outer side of the zigzag (the centre
 *  column's labels go left) — the side the guide never stands on, and
 *  clear of the trail, which leaves and enters every stop vertically. */
function sideLabelStyle(p: Pt, size: number): React.CSSProperties {
  const edge = size / 2 + SIDE_GAP;
  return p.x > W / 2
    ? { left: p.x + edge, top: p.y, transform: "translateY(-50%)" }
    : { right: W - (p.x - edge), top: p.y, transform: "translateY(-50%)" };
}

/**
 * The school-year journey, led by the character (character-led redesign,
 * Task 5 item 2; school-year framing added with the entry flow).
 *
 * The character stands at the kid's current stop, full-size and talking —
 * not a 64px thumbnail beside it — and says where we are, by name. A
 * "עד כאן הגעת" marker sits on that stop.
 *
 * The year: every topic carries a rough month (September → June, spread
 * by list order), and two holiday stops — חנוכה and פסח — sit on the path
 * as distinct milestones (a gold diamond, not a circle). Months and
 * milestones are framing only: they never lock or unlock anything.
 * Tapping a milestone gets a line about it, nothing else.
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
 * The character reacts to the state of the path: the first time a
 * subject's map opens → one line framing the year; first stop → an
 * invitation; mid-path → "here's our next stop"; every stop done → it
 * stands on the last one in `celebration`; a locked tap → it redirects
 * (still `idle`, talking). Tapping the character repeats its line.
 *
 * Stop completion is explicit: `practice_state.topics[id].journeyDoneAt`,
 * written only when a topic is answered correctly from this map (never
 * from free practice) — see lib/practice/state.ts. Replaces the old
 * derivation from the dashboard's last-10 attempts, which forgot stops
 * once they scrolled out of that window.
 */
export default function ProgressMap({ character, kidName, grade, practice, loaded, onPickTopic, onIntroSeen }: Props) {
  const [subject, setSubject] = useState<Subject>("math");
  const [override, setOverride] = useState<Line | null>(null);
  const [attention, setAttention] = useState(0);
  // Subjects whose intro this visit is showing. Held here, not re-derived
  // from `practice`, so the line doesn't swap mid-sentence once the parent
  // records it as seen.
  const [introFor, setIntroFor] = useState<Subject[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);

  const topics = getTopics(subject, grade);
  const stops = buildJourney(topics);
  const doneIds = journeyDoneIds(practice[subject]);
  const doneCount = topics.filter((t) => doneIds.has(t.id)).length;

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
  // every stop is walked. (Topic index; stageStop below is its place on
  // the path, milestones included.)
  const stageIndex = allDone ? topics.length - 1 : currentIndex;

  // Per path stop: walked past it (a done topic, or a milestone every
  // earlier topic is done for), and is it the current topic.
  const passed = stops.map((s, i) =>
    s.kind === "topic"
      ? states[s.topicIndex] === "done"
      : stops.slice(0, i).every((p) => p.kind !== "topic" || states[p.topicIndex] === "done")
  );
  const isCurrent = stops.map((s) => s.kind === "topic" && s.topicIndex === currentIndex);
  const stageStop = stops.findIndex((s) => s.kind === "topic" && s.topicIndex === stageIndex);

  // ---- The year-intro line ----
  const needsIntro = loaded && topics.length > 0 && !practice[subject]?.journeyIntroSeenAt;
  const showIntro = needsIntro || introFor.includes(subject);
  useEffect(() => {
    if (!needsIntro || introFor.includes(subject)) return;
    setIntroFor((s) => [...s, subject]);
    onIntroSeen(subject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsIntro, subject]);

  // ---- What the character says and does ----
  const otherLabel = SUBJECTS.find((s) => s.value !== subject)!.label;
  // Valid whenever topics.length > 0, since stageIndex is either
  // currentIndex or (once every stop is done) the last topic's index.
  const currentTopic = topics[stageIndex]?.topic;
  const autoLine: Line | null = !loaded
    ? null
    : topics.length === 0
      ? lines.mapEmpty(kidName, otherLabel)
      : allDone
        ? lines.mapAllDone(kidName)
        : showIntro
          ? lines.journeyIntro(kidName, doneCount > 0)
          : doneCount === 0
            ? lines.mapFirst(kidName, currentTopic!)
            : lines.mapNext(kidName, currentTopic!);
  const line = override ?? autoLine;
  const basePose: CharacterPose = !loaded || topics.length === 0 ? "thinking" : allDone ? "celebration" : "idle";
  const guide = useGuide({
    owner: OWNER,
    character,
    pose: basePose,
    line,
    // Speak on arrival, and again whenever the stop or subject changes —
    // not when a tap override swaps the words (that's said directly in
    // the tap handler).
    cue: loaded ? `${subject}:${stageIndex}:${topics.length}:${showIntro ? "intro" : ""}` : null,
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

  function onMilestoneTap(m: Milestone, reached: boolean) {
    const l = reached ? lines.milestoneReached(kidName, m.label) : lines.milestoneAhead(kidName, m.label);
    setOverride(l);
    guide.say(l);
  }

  // ---- Layout ----
  const pts: Pt[] = [];
  let y = PAD_TOP + NODE / 2;
  stops.forEach((_, i) => {
    if (i === stageStop) y += STAGE + (showIntro ? INTRO_EXTRA : 0);
    pts.push({ x: W / 2 + OFFSETS[i % 3], y });
    y += ROW;
  });
  const height = (pts.at(-1)?.y ?? 0) + NODE / 2 + PAD_BOTTOM;

  const segments = pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1];
    const kind: "walked" | "ahead" | "locked" = isCurrent[i]
      ? "ahead"
      : passed[i] && (passed[i + 1] || isCurrent[i + 1])
        ? "walked"
        : "locked";
    const ym = (p.y + q.y) / 2;
    return { key: i, kind, p, q, d: `M ${p.x} ${p.y} C ${p.x} ${ym}, ${q.x} ${ym}, ${q.x} ${q.y}` };
  });

  const stage = stageStop >= 0 ? pts[stageStop] : null;
  const stageSize = stageIndex === currentIndex ? NODE_CURRENT : NODE;
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

          {stops.map((s, i) => {
            const p = pts[i];
            if (s.kind === "milestone") {
              const reached = passed[i];
              const { milestone: m } = s;
              return (
                <div key={m.id}>
                  <button
                    type="button"
                    data-milestone={m.id}
                    onClick={() => onMilestoneTap(m, reached)}
                    aria-label={`${m.label} — ${reached ? "הגענו" : "בהמשך הדרך"}`}
                    className="absolute flex items-center justify-center"
                    style={{ left: p.x - MILESTONE / 2, top: p.y - MILESTONE / 2, width: MILESTONE, height: MILESTONE }}
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-0 rotate-45 rounded-[16px] shadow-md border-4 ${
                        reached ? "bg-amber-300 border-amber-500" : "bg-amber-50 border-amber-300 border-dashed"
                      }`}
                    />
                    <span aria-hidden className={`relative text-3xl ${reached ? "" : "opacity-70"}`}>
                      {m.emoji}
                    </span>
                  </button>
                  <span
                    aria-hidden
                    className="absolute whitespace-nowrap text-sm font-bold text-amber-700"
                    style={sideLabelStyle(p, MILESTONE * 1.42)}
                  >
                    {m.label}
                  </span>
                </div>
              );
            }
            const size = s.topicIndex === currentIndex ? NODE_CURRENT : NODE;
            const state = states[s.topicIndex];
            return (
              <div key={s.topic.id}>
                <div className="absolute" style={{ left: p.x - size / 2, top: p.y - size / 2 }}>
                  <MapNode
                    topic={s.topic.topic}
                    state={state}
                    size={size}
                    attention={s.topicIndex === currentIndex ? attention : 0}
                    onTap={() => {
                      if (state === "locked") onLockedTap();
                      else onPickTopic(subject, s.topic.id, state === "done");
                    }}
                  />
                </div>
                <span
                  aria-hidden
                  className={`absolute whitespace-nowrap text-[11px] font-semibold ${
                    state === "locked" ? "text-slate-400" : "text-[var(--color-ink-soft)]"
                  }`}
                  style={sideLabelStyle(p, size)}
                >
                  {s.month}
                </span>
              </div>
            );
          })}

          {stage && (
            <div
              aria-hidden
              className="absolute pointer-events-none flex flex-col items-center"
              style={{ left: stage.x, top: stage.y - stageSize / 2 - 4, transform: "translate(-50%, -100%)" }}
            >
              <span className="whitespace-nowrap rounded-full bg-[var(--color-teal-ink)] text-white text-xs font-bold px-3 py-1 shadow-sm">
                עד כאן הגעת
              </span>
              <span className="w-2.5 h-2.5 rotate-45 -mt-1.5 bg-[var(--color-teal-ink)]" />
            </div>
          )}

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
                  eyebrow={!allDone ? currentTopic : undefined}
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
