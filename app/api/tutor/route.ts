import { NextRequest, NextResponse, after } from "next/server";
import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { search } from "@/lib/rag/store";
import {
  buildTutorSystemPrompt,
  looksOffCurriculumOrEmotional,
} from "@/lib/prompts/tutor-system-prompt";
import { generateExercise, NoCurriculumContentError } from "@/lib/exercises/generate";
import {
  evaluateVerdict,
  generateFeedbackProse,
  safeFeedbackAfterOpener,
  OPENERS,
  type LockedVerdict,
} from "@/lib/exercises/evaluate";
import { Exercise } from "@/lib/exercises/types";
import { findReusableExercise, saveExercise, recordAttempt, sanitizeExcludeIds } from "@/lib/exercises/store";
import { getKid, getSubjectProfile, updateSubjectProfile } from "@/lib/memory/store";
import {
  factsFromAnswer,
  factsFromChatTurn,
  formatMemoryBlock,
  markReferenced,
  openLoops,
  recentKidFacts,
  saveKidFacts,
  MAX_CHAT_EXCHANGES,
  type ChatMode,
} from "@/lib/memory/kidMemory";
import { buildScopedChatPrompt } from "@/lib/prompts/scoped-chat-prompt";
import { saveParentFlag } from "@/lib/dashboard/store";
import { updateSubjectProfileFromExchange } from "@/lib/memory/update";
import { Subject, emptySubjectProfile } from "@/lib/memory/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { synthesizeSpeech, TtsNotConfiguredError, MAX_TTS_CHARS } from "@/lib/tts/cartesia";
import type { CharacterId } from "@/lib/characters";
import { getTopicById } from "@/lib/map/topics";
import { getPracticeState, savePracticeState } from "@/lib/practice/store";
import {
  levelForNextExercise,
  recordAnswer,
  summarize,
  type PracticeMode,
  type PracticeSummary,
} from "@/lib/practice/state";

export const runtime = "nodejs";

/**
 * Consolidates what used to be /api/chat, /api/exercise, and
 * /api/exercise/answer into one route, dispatched by an `action` field.
 *
 * Why: Vercel's Hobby plan caps a deployment at 12 serverless functions.
 * Next.js compiles each route file into 2 functions (a base handler + an
 * RSC payload function) regardless of route type — 3 separate tutor-related
 * route files cost 6 functions for logic that's really one feature area.
 * One file with an action dispatcher costs 2. No behavior changed for any
 * individual action, only which URL/shape groups them.
 *
 * One consequence of that consolidation (2026-09-12 iPhone QA — "everything
 * is slow"): all four actions share ONE Vercel function, so a static
 * top-level import anywhere in this file is paid by every cold start of
 * that function, regardless of which action woke it. `embedText`
 * (lib/rag/embed.ts) pulls in @huggingface/transformers — onnxruntime,
 * sharp, and the ~100MB MiniLM weights — and only `chat` and (sometimes)
 * `generate_exercise` actually need it; `speak` and `answer_exercise`
 * never do. It's dynamically imported inside the two functions that
 * actually call it (here and in lib/exercises/generate.ts) instead of
 * statically at the top of either file — keep it that way; a static
 * import at either module's top reintroduces the cost for every action.
 */

type Action = "chat" | "scoped_chat" | "generate_exercise" | "answer_exercise" | "speak";

/**
 * feat: scoped kid chat. A NEW path, not a revival of `chat` above — that
 * one is an open-ended curriculum tutor with RAG and no turn limit, and it
 * stays dead. This one can only run two scripted conversations.
 *
 * An action here rather than its own route file for the reason in this
 * file's header: a route file costs 2 serverless functions against the
 * Hobby cap. It never touches the embedding stack, so it adds nothing to
 * any other action's cold start.
 */
interface ScopedChatBody {
  action: "scoped_chat";
  mode: ChatMode;
  kidId: string;
  message: string;
  /** Whose voice and persona. Supplied by the client, which already holds
   *  it, and validated against the two real values below — lib/characters.ts
   *  is a "use client" module (it carries a hook), so its normalizer cannot
   *  be called from here. Same trust level as kidGender on answer_exercise:
   *  it picks a word in the tutor's own line, nothing more. */
  character?: CharacterId;
  /** The transcript so far, oldest first. The turn cap is counted from
   *  this server-side; see handleScopedChat. */
  history?: { role: "kid" | "character"; content: string }[];
  sessionId?: string;
}

interface ChatBody {
  action: "chat";
  message: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  history?: { role: "user" | "assistant"; content: string }[];
  kidId?: string;
}

interface AnswerExerciseBodyGenderExtra {
  /** Voice-experience fix item 4 (2026-09-15): sourced from the client,
   *  not re-looked-up here — handleAnswerExercise already runs its
   *  evaluateExerciseAnswer call and its getKid(kidId) call in parallel
   *  (see the Promise.all below, a deliberate latency win), so kid.gender
   *  isn't available yet at the point evaluateExerciseAnswer needs it.
   *  Low-stakes cosmetic data (which grammatical form the tutor's own
   *  reply uses), not re-verified against the DB — same trust level
   *  kidName already gets elsewhere in this file. */
  kidGender?: "boy" | "girl" | null;
}

interface GenerateExerciseBody {
  action: "generate_exercise";
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  kidId?: string;
  /** Map node's topic id (feat: topic-scoped exercise generation).
   *  Optional and backward compatible — omitted, it's exactly the old
   *  subject+grade behavior. See lib/exercises/generate.ts and
   *  lib/exercises/store.ts for how an unrecognized/mismatched id is
   *  handled (falls back, doesn't error). */
  topic?: string;
  /** Ids of exercises the client has already shown this visit — untrusted,
   *  sanitized by sanitizeExcludeIds. Lets an overlap-turns prefetch avoid
   *  returning the exercise still on screen (not yet attempted, so the
   *  server's own "already attempted" exclusion cannot see it). */
  excludeIds?: unknown;
}

interface AnswerExerciseBody extends AnswerExerciseBodyGenderExtra {
  action: "answer_exercise";
  exercise: Exercise;
  answer: string;
  kidId?: string;
  /** The topic the exercise was served for — the adaptive level and journey
   *  completion are tracked per topic (lib/practice/state.ts). Omitted,
   *  nothing practice-related is written. */
  topicId?: string;
  /** "journey" (from the map) may complete the stop; "free" never does. */
  mode?: PracticeMode;
  /** 1 = first answer to this question, 2 = the retry after a hint. */
  attempt?: 1 | 2;
  /** Groups the facts written for this answer into one session (feat: kid
   *  session memory). The client's own session clock — there is no sessions
   *  table, and inventing one to label a group of rows would be a bigger
   *  claim than this needs. */
  sessionId?: string;
}

interface SpeakBody {
  action: "speak";
  /** The line the character says. */
  text: string;
  /** Whose voice (lib/voices.ts). */
  character: CharacterId;
  /** True when this is a warm-up, not a line anyone is waiting to hear
   *  (lib/speech/useSpeech.ts's prefetchSpeech). Only effect: the niqqud
   *  step is allowed to take its time, since no child is waiting on it. */
  prefetch?: boolean;
  /** True for a line a model just wrote (the feedback prose). Per the
   *  niqqud ruling, live prose is not vocalized at all — see
   *  lib/tts/cartesia.ts. */
  live?: boolean;
}

type RequestBody = ChatBody | ScopedChatBody | GenerateExerciseBody | AnswerExerciseBody | SpeakBody;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody & { action?: Action };

  const supabase = await getSupabaseServerClient();

  switch (body.action) {
    case "chat":
      return handleChat(supabase, body);
    case "scoped_chat":
      return handleScopedChat(supabase, body);
    case "generate_exercise":
      return handleGenerateExercise(supabase, body);
    case "answer_exercise":
      return handleAnswerExercise(supabase, body);
    case "speak":
      return handleSpeak(supabase, body, req.signal);
    default:
      return NextResponse.json({ error: "unknown or missing action" }, { status: 400 });
  }
}

async function handleChat(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { message, subject, grade, history = [], kidId }: ChatBody
) {
  if (!message || !subject || !grade) {
    return NextResponse.json(
      { error: "message, subject, and grade are required" },
      { status: 400 }
    );
  }

  const flagged = looksOffCurriculumOrEmotional(message);

  // embedText() is the slowest single step here (a local ONNX model
  // inference) and doesn't depend on the kid/profile lookup at all — runs
  // concurrently with it, part of the "make it faster" pass (Asaf,
  // 2026-08-31). The import is dynamic (not a static top-of-file import —
  // see the file header) so a cold start of this shared function only
  // pays @huggingface/transformers's load cost when a `chat` request
  // actually arrives, not on every cold start regardless of action.
  const [kid, queryEmbedding] = await Promise.all([
    kidId ? getKid(supabase, kidId) : Promise.resolve(null),
    import("@/lib/rag/embed").then((m) => m.embedText(message)),
  ]);
  const subjectProfile = kid ? await getSubjectProfile(supabase, kid.id, subject as Subject) : null;

  if (flagged && kid) {
    // The "flag to parent" half of the locked "gentle redirect + flag to
    // parent" decision — this used to just console.log; now it's a real
    // row a parent can actually see on the dashboard.
    try {
      await saveParentFlag(supabase, { kidId: kid.id, subject: subject as Subject, grade, message });
    } catch (err) {
      console.error("[flag-for-parent] failed to save flag:", err);
    }
  }

  const retrieved = search(queryEmbedding, { subject, grade, topK: 4 });

  const systemPrompt = buildTutorSystemPrompt(grade, subject, retrieved, subjectProfile, kid?.name, kid?.gender);
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    // Was 512, then 260 (model still produced 4+ sentences plus markdown/
    // greeting filler within that budget — the prompt instruction alone
    // wasn't enough, tightened separately), then 150 (tested live: cut a
    // real explanation off mid-sentence — too tight once the greeting/
    // markdown filler was already gone via the prompt fix, since a
    // genuine 2-3 sentence concept explanation needs real room). 200 is
    // the value that held a complete, on-length reply in live testing.
    max_tokens: 200,
    system: systemPrompt,
    messages: [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: message },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const reply = textBlock && textBlock.type === "text" ? textBlock.text : "";

  // The kid reads `reply` the moment the model returns it — the memory-
  // layer update is a SECOND LLM call the kid was, until now, waiting on
  // for no reason (2026-09-12 iPhone QA: "everything is slow"). after()
  // (next/server) runs this once the response is on its way, on the same
  // warm invocation rather than a new one. Same calls, same order, same
  // error handling as before — only when they run changed. (The brief for
  // this task named `waitUntil` from next/server; this Next version
  // exports `after`, not `waitUntil` — same fire-and-forget-after-response
  // primitive, different name.)
  if (kid) {
    after(async () => {
      try {
        const patch = await updateSubjectProfileFromExchange(subjectProfile ?? emptySubjectProfile(), {
          grade,
          subject,
          kidName: kid.name,
          userMessage: message,
          tutorReply: reply,
        });
        if (patch) {
          await updateSubjectProfile(supabase, kid.id, subject as Subject, patch);
        }
      } catch (err) {
        console.error("[memory-update] error updating profile after exchange:", err);
      }
    });
  }

  return NextResponse.json({
    reply,
    flaggedForParent: flagged,
    retrievedTopics: retrieved.map((r) => r.topic),
  });
}

/** The only two conversations that exist. Anything else is a 400, in code
 *  — the prompt's own "this is not a free chat" line is a second layer,
 *  never the enforcement. */
const CHAT_MODES: ChatMode[] = ["onboarding", "checkin"];
/** A kid's turn is a sentence, not an essay; also bounds what reaches the
 *  model and the flag table. */
const MAX_CHAT_MESSAGE_CHARS = 300;
/** Said in code, not by the model, when the cap is reached — gender-free
 *  (lib/guide/lines.ts rule 3) since niqqud/TTS can't know the kid. */
const CHAT_CLOSING_LINE = "איזה כיף לדבר! יאללה, מתחילים ללמוד.";

/**
 * feat: scoped kid chat — onboarding and daily check-in, nothing else.
 *
 * Every limit is enforced here rather than asked for in the prompt: the
 * mode whitelist, the turn cap counted off the transcript, the message
 * length, and the ownership check that getKid() performs under RLS.
 *
 * Distress goes through the SAME detector and the SAME parent_flags write
 * the tutor path uses (looksOffCurriculumOrEmotional + saveParentFlag) —
 * there is no second detection path here, only a reply policy added to the
 * prompt once that shared detector has already fired.
 */
async function handleScopedChat(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { mode, kidId, message, character, history = [], sessionId }: ScopedChatBody
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!CHAT_MODES.includes(mode)) {
    return NextResponse.json({ error: "unsupported mode" }, { status: 400 });
  }
  const text = typeof message === "string" ? message.trim() : "";
  if (!kidId || !text) {
    return NextResponse.json({ error: "kidId and message are required" }, { status: 400 });
  }
  if (text.length > MAX_CHAT_MESSAGE_CHARS) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const kid = await getKid(supabase, kidId);
  if (!kid) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The cap, counted from the transcript the client submitted. A client
  // could under-report its own history, but the worst case is a slightly
  // longer chat — not a wider one, since the mode and the prompt still
  // hold. Past the cap nothing reaches the model at all.
  const kidTurns = history.filter((h) => h.role === "kid").length;
  if (kidTurns >= MAX_CHAT_EXCHANGES) {
    return NextResponse.json({ reply: CHAT_CLOSING_LINE, done: true });
  }
  const isFinal = kidTurns + 1 >= MAX_CHAT_EXCHANGES;

  const distress = looksOffCurriculumOrEmotional(text);
  if (distress) {
    // Same write the tutor path makes; no subject/grade, because a hard
    // moment in a check-in doesn't belong to one.
    await saveParentFlag(supabase, { kidId: kid.id, message: text });
  }

  const loops = mode === "checkin" ? await openLoops(supabase, kid.id) : [];

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: TUTOR_MODEL,
    max_tokens: 160,
    system: buildScopedChatPrompt({
      mode,
      kidName: kid.name,
      grade: kid.grade,
      character: character === "boy" || character === "girl" ? character : "girl",
      kidGender: kid.gender,
      exchangeIndex: kidTurns,
      isFinal,
      loops,
      distress,
    }),
    messages: [
      ...history.map((h) => ({ role: h.role === "kid" ? ("user" as const) : ("assistant" as const), content: h.content })),
      { role: "user" as const, content: text },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  const reply = block && block.type === "text" ? block.text.trim() : CHAT_CLOSING_LINE;

  after(async () => {
    try {
      // A flagged turn is never remembered. "אני עצוב" filed under
      // חברים would resurface later as cheerful specific praise, which is
      // the worst thing this memory could do. The parent flag is the
      // record of that moment; kid_memory is not.
      if (!distress) {
        await saveKidFacts(
          supabase,
          kid.id,
          factsFromChatTurn(mode, kidTurns, text, loops[0]?.topic),
          sessionId ?? null
        );
      }
      // Marks everything the character was shown, not just what it chose:
      // all of it was raised, and re-asking tomorrow is the failure mode
      // this column exists to stop.
      if (loops.length > 0) await markReferenced(supabase, kid.id, loops.map((l) => l.id));
    } catch (err) {
      console.error("[scoped-chat] post-reply bookkeeping failed:", err);
    }
  });

  return NextResponse.json({ reply, done: isFinal });
}

async function handleGenerateExercise(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { subject, grade, kidId, topic, excludeIds }: GenerateExerciseBody
) {
  if (!subject || !grade) {
    return NextResponse.json({ error: "subject and grade are required" }, { status: 400 });
  }

  // Source marker + server-side timing breakdown (2026-09-15, production
  // QA: a bank hit was taking 2.3-4.25s — indistinguishable from the
  // pre-bank live-generation baseline from outside the request). Every
  // branch below reports which path was actually taken and how long each
  // piece cost, in BOTH the JSON response and a server log line, so a
  // future "the bank feels slow" report can be diagnosed from real
  // numbers instead of guessed at again.
  const t0 = Date.now();
  const kid = kidId ? await getKid(supabase, kidId) : null;
  const getKidMs = Date.now() - t0;

  // The kid's adaptive level on this topic decides what gets reused or
  // built. getKid() already read the profile rows, practice state
  // included — no extra query. No level yet = the diagnostic, which runs
  // at the default level.
  const topicState = kid && topic ? kid.subjects[subject as Subject]?.practice?.topics?.[topic] : undefined;
  const level = levelForNextExercise(topicState);
  const practice = kid && topic ? summarize(topicState) : undefined;

  try {
    const tFind = Date.now();
    const reused = await findReusableExercise(
      supabase,
      subject,
      grade,
      kid?.id ?? null,
      topic,
      level,
      sanitizeExcludeIds(excludeIds)
    );
    const findMs = Date.now() - tFind;
    if (reused) {
      const totalMs = Date.now() - t0;
      console.log(
        `[exercise-generate] source=bank-hit topic=${topic ?? "(none)"} difficulty=${level} getKidMs=${getKidMs} findMs=${findMs} totalMs=${totalMs}`
      );
      return NextResponse.json({
        exercise: reused,
        reused: true,
        practice,
        source: "bank-hit",
        timings: { getKidMs, dbLookupMs: findMs, totalMs },
      });
    }

    const tProfile = Date.now();
    const profile = kid ? await getSubjectProfile(supabase, kid.id, subject as Subject) : null;
    const profileMs = Date.now() - tProfile;
    const tGenerate = Date.now();
    const generated = await generateExercise({ subject, grade, profile, topicId: topic, level });
    const generateMs = Date.now() - tGenerate;
    const tSave = Date.now();
    const saved = await saveExercise(supabase, generated);
    const saveMs = Date.now() - tSave;
    const totalMs = Date.now() - t0;
    console.log(
      `[exercise-generate] source=bank-miss-fallback topic=${topic ?? "(none)"} difficulty=${level} getKidMs=${getKidMs} findMs=${findMs} profileMs=${profileMs} generateMs=${generateMs} saveMs=${saveMs} totalMs=${totalMs}`
    );
    return NextResponse.json({
      exercise: saved,
      reused: false,
      practice,
      source: "bank-miss-fallback",
      timings: { getKidMs, dbLookupMs: findMs, profileMs, generateMs, saveMs, totalMs },
    });
  } catch (err) {
    // Genuinely nothing to practice for this subject/grade/topic — an
    // expected answer, not a fault, so it gets its own status the client
    // can tell apart from a real failure (which stays a 500).
    if (err instanceof NoCurriculumContentError) {
      console.warn("[exercise-generate] no content:", err.message);
      return NextResponse.json({ exercise: null, error: "no_content" }, { status: 404 });
    }
    console.error("[exercise-generate] error:", err);
    return NextResponse.json({ error: "failed to generate exercise" }, { status: 500 });
  }
}

/**
 * feat: verdict-first evaluation. Answers stream back as NDJSON, two
 * lines:
 *
 *   {"type":"verdict","correct":bool,"opener":"..."}
 *   {"type":"prose","feedback":"...","errorNote":"...","practice":{...}}
 *
 * The first line leaves as soon as the verdict is locked — on a
 * computation exercise that is pure code, no model call at all — so the
 * character can say its deterministic opener while the prose is still
 * being written. Before this, nothing was audible until the single
 * combined call returned (measured p50 1934ms).
 *
 * The prose on the second line has already passed lineIsArithmeticallySafe
 * as one whole text. It is never streamed in pieces: a false claim split
 * across a sentence boundary is invisible to that gate sentence by
 * sentence, as is a wrong stated answer, so partial prose must never
 * reach a child.
 */
async function handleAnswerExercise(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { exercise, answer, kidId, kidGender, topicId, mode, attempt, sessionId }: AnswerExerciseBody
) {
  if (!exercise || !answer) {
    return NextResponse.json({ error: "exercise and answer are required" }, { status: 400 });
  }
  const tryNumber: 1 | 2 = attempt === 2 ? 2 : 1;

  // Both start now and neither blocks the verdict. The memory read used to
  // sit in front of the model call because the evaluator needed it to cite
  // history; only the PROSE call needs it, and that one no longer gates
  // the first thing the child hears.
  const kidPromise = kidId ? getKid(supabase, kidId) : Promise.resolve(null);
  const memoryPromise = kidId
    ? recentKidFacts(supabase, kidId)
        .then(formatMemoryBlock)
        .catch(() => "")
    : Promise.resolve("");

  let verdict: LockedVerdict;
  try {
    verdict = await evaluateVerdict(exercise, answer, { secondAttempt: tryNumber === 2 });
  } catch (err) {
    console.error("[exercise-evaluate] verdict failed:", err);
    return NextResponse.json({ error: "failed to evaluate answer" }, { status: 500 });
  }
  const opener = OPENERS[verdict.openerKind];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      // Line 1 — the verdict and the opener, the moment they exist.
      send({ type: "verdict", correct: verdict.correct, opener });

      // The practice write and the prose call are independent of each
      // other; both happen while the opener is being spoken.
      const practicePromise = (async (): Promise<{
        practice?: PracticeSummary;
        justFinishedTopic: boolean;
        kid: Awaited<typeof kidPromise>;
      }> => {
        const kid = await kidPromise;
        const topicMeta = topicId ? getTopicById(topicId) : undefined;
        if (!kid || !topicMeta || topicMeta.subject !== exercise.subject) {
          return { justFinishedTopic: false, kid };
        }
        try {
          const current = await getPracticeState(supabase, kid.id, topicMeta.subject);
          const wasFinished = !!current.topics?.[topicMeta.id]?.journeyDoneAt;
          const result = recordAnswer(current, topicMeta.id, {
            correct: verdict.correct,
            attempt: tryNumber,
            mode: mode === "journey" ? "journey" : "free",
            at: new Date().toISOString(),
          });
          const justFinishedTopic = !wasFinished && !!result.topic.journeyDoneAt;
          await savePracticeState(supabase, kid.id, topicMeta.subject, result.state);
          return { practice: summarize(result.topic, result.change), justFinishedTopic, kid };
        } catch (err) {
          // The kid still gets their feedback; the level just doesn't move.
          console.error("[exercise-answer] practice state update failed:", err instanceof Error ? err.message : err);
          return { justFinishedTopic: false, kid };
        }
      })();

      const prosePromise = (async () => {
        try {
          return await generateFeedbackProse(exercise, answer, verdict, {
            childGender: kidGender,
            memoryBlock: await memoryPromise,
          });
        } catch (err) {
          // The verdict is already locked and already spoken. A failed
          // prose call must not cost the child their feedback, so fall
          // through to the same deterministic remainder the gate uses.
          console.error("[exercise-evaluate] prose failed, using deterministic line:", err);
          return {
            feedback: safeFeedbackAfterOpener("", {
              verifiedAnswer: verdict.verifiedAnswer,
              correct: verdict.correct,
              secondAttempt: verdict.secondAttempt,
              computation: exercise.computation,
            }),
            errorNote: undefined as string | undefined,
          };
        }
      })();

      const [{ practice, justFinishedTopic, kid }, prose] = await Promise.all([practicePromise, prosePromise]);

      // Line 2 — the gated prose, plus the level the answer moved.
      send({ type: "prose", feedback: prose.feedback, errorNote: prose.errorNote, practice });
      controller.close();

      // What the character actually said, end to end. Everything
      // downstream (the attempt log's spokenLine, the memory layer's
      // tutorReply) records the whole utterance, not half of it.
      const spokenLine = `${opener} ${prose.feedback}`.trim();

      // The kid has had their feedback — recordAttempt and the
      // memory-layer update (a second LLM call) are bookkeeping they were,
      // until now, waiting on for no reason (2026-09-12 iPhone QA:
      // "everything is slow"). after() (next/server) defers exactly this
      // block to run once the response is on its way.
      if (kid) {
        after(async () => {
          try {
            // feat: kid session memory — the episodic half, alongside the
            // rolling subject profile below. Derived in code from what the
            // evaluation already returned (no second model call).
            const topicMeta = topicId ? getTopicById(topicId) : undefined;
            if (topicMeta) {
              await saveKidFacts(
                supabase,
                kid.id,
                factsFromAnswer({
                  topicLabel: topicMeta.displayNameKid,
                  correct: verdict.correct,
                  attempt: tryNumber,
                  errorNote: prose.errorNote,
                  leveledUp: practice?.change === "up",
                  topicCompleted: justFinishedTopic,
                }),
                sessionId ?? null
              );
            }

            const [, current] = await Promise.all([
              recordAttempt(supabase, {
                kidId: kid.id,
                exerciseId: exercise.id,
                subject: exercise.subject,
                correct: verdict.correct,
                errorNote: prose.errorNote,
                kidAnswer: answer,
                correctAnswer: exercise.correctAnswer,
                spokenLine,
              }).catch((err) => {
                console.error("[exercise-answer] attempt logging failed:", err);
              }),
              getSubjectProfile(supabase, kid.id, exercise.subject as Subject),
            ]);
            const profileBase = current ?? emptySubjectProfile();
            const patch = await updateSubjectProfileFromExchange(profileBase, {
              grade: exercise.grade,
              subject: exercise.subject,
              kidName: kid.name,
              userMessage: `[תרגיל: ${exercise.question}] תשובת התלמיד/ה: ${answer}`,
              tutorReply: spokenLine,
              exercise: {
                topic: exercise.topic,
                correct: verdict.correct,
                errorNote: prose.errorNote,
              },
            });
            if (patch) {
              await updateSubjectProfile(supabase, kid.id, exercise.subject as Subject, patch);
            }
          } catch (err) {
            console.error("[exercise-answer] memory update failed:", err);
          }
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * The characters' voices: text -> Cartesia -> MP3, streamed straight
 * back. Lives in this route as an action rather than its own route file
 * so it costs zero extra serverless functions (Vercel Hobby 12-function
 * cap — see the note at the top of this file).
 *
 * Requires a signed-in parent, unlike the other actions: every call here
 * spends Cartesia credit, so an open endpoint would be a free TTS proxy
 * for anyone who found the URL. Status codes are part of the client
 * contract (lib/speech/useSpeech.ts): 401/503 switch the client to the
 * browser voice for the session; 502 falls back for that one line.
 *
 * Never logs the text — lines address the kid by name.
 */
async function handleSpeak(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { text, character, prefetch, live }: SpeakBody,
  signal: AbortSignal
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TTS_CHARS) {
    return NextResponse.json({ error: `text is required, max ${MAX_TTS_CHARS} characters` }, { status: 400 });
  }
  if (character !== "boy" && character !== "girl") {
    return NextResponse.json({ error: "character must be boy or girl" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await synthesizeSpeech(text, character, signal, {
      prefetch: prefetch === true,
      live: live === true,
    });
  } catch (err) {
    if (err instanceof TtsNotConfiguredError) {
      return NextResponse.json({ error: "tts_not_configured" }, { status: 503 });
    }
    console.error("[tts] cartesia request failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "tts_failed" }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("[tts] cartesia error:", upstream.status, detail.slice(0, 300));
    return NextResponse.json({ error: "tts_failed" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
