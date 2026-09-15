import { NextRequest, NextResponse, after } from "next/server";
import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import { search } from "@/lib/rag/store";
import {
  buildTutorSystemPrompt,
  looksOffCurriculumOrEmotional,
} from "@/lib/prompts/tutor-system-prompt";
import { generateExercise, NoCurriculumContentError } from "@/lib/exercises/generate";
import { evaluateExerciseAnswer } from "@/lib/exercises/evaluate";
import { Exercise } from "@/lib/exercises/types";
import { findReusableExercise, saveExercise, recordAttempt } from "@/lib/exercises/store";
import { getKid, getSubjectProfile, updateSubjectProfile } from "@/lib/memory/store";
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

type Action = "chat" | "generate_exercise" | "answer_exercise" | "speak";

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
}

interface SpeakBody {
  action: "speak";
  /** The line the character says. */
  text: string;
  /** Whose voice (lib/voices.ts). */
  character: CharacterId;
}

type RequestBody = ChatBody | GenerateExerciseBody | AnswerExerciseBody | SpeakBody;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody & { action?: Action };

  const supabase = await getSupabaseServerClient();

  switch (body.action) {
    case "chat":
      return handleChat(supabase, body);
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

async function handleGenerateExercise(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { subject, grade, kidId, topic }: GenerateExerciseBody
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
    const reused = await findReusableExercise(supabase, subject, grade, kid?.id ?? null, topic, level);
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

async function handleAnswerExercise(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  { exercise, answer, kidId, kidGender, topicId, mode, attempt }: AnswerExerciseBody
) {
  if (!exercise || !answer) {
    return NextResponse.json({ error: "exercise and answer are required" }, { status: 400 });
  }
  const tryNumber: 1 | 2 = attempt === 2 ? 2 : 1;

  // evaluateExerciseAnswer (the LLM call) and getKid (a DB lookup) don't
  // depend on each other — was previously two sequential awaits, meaning
  // the kid lookup didn't even start until the several-second LLM call
  // finished. Running them concurrently, with the same error handling
  // and early-return behavior as before, just not serialized for no
  // reason. Part of the "make it faster" pass (Asaf, 2026-08-31).
  const [evaluationOutcome, kid] = await Promise.all([
    evaluateExerciseAnswer(exercise, answer, { secondAttempt: tryNumber === 2, childGender: kidGender }).then(
      (value) => ({ ok: true as const, value }),
      (err) => ({ ok: false as const, err })
    ),
    kidId ? getKid(supabase, kidId) : Promise.resolve(null),
  ]);

  if (!evaluationOutcome.ok) {
    console.error("[exercise-evaluate] error:", evaluationOutcome.err);
    return NextResponse.json({ error: "failed to evaluate answer" }, { status: 500 });
  }
  const evaluation = evaluationOutcome.value;

  // Adaptive level + journey completion (lib/practice/state.ts). Written
  // BEFORE the response, unlike the bookkeeping below: the next exercise
  // is built at the level this sets, and the screen shows the change.
  // Only for a kid this parent owns (getKid runs under the parent's RLS)
  // and a topic that belongs to the exercise's subject. Completion needs
  // an explicit mode "journey" — free practice never moves the map.
  let practice: PracticeSummary | undefined;
  const topicMeta = topicId ? getTopicById(topicId) : undefined;
  if (kid && topicMeta && topicMeta.subject === exercise.subject) {
    try {
      const current = await getPracticeState(supabase, kid.id, topicMeta.subject);
      const result = recordAnswer(current, topicMeta.id, {
        correct: evaluation.correct,
        attempt: tryNumber,
        mode: mode === "journey" ? "journey" : "free",
        at: new Date().toISOString(),
      });
      await savePracticeState(supabase, kid.id, topicMeta.subject, result.state);
      practice = summarize(result.topic, result.change);
    } catch (err) {
      // The kid still gets their feedback; the level just doesn't move.
      console.error("[exercise-answer] practice state update failed:", err instanceof Error ? err.message : err);
    }
  }

  // The kid gets `evaluation` (right/wrong + feedback) the moment it's
  // judged — recordAttempt and the memory-layer update (a second LLM
  // call) are bookkeeping the kid was, until now, waiting on for no
  // reason (2026-09-12 iPhone QA: "everything is slow"). after()
  // (next/server) defers exactly this block to run once the response is
  // on its way; same calls, same order, same error handling as before.
  // (See handleChat's after() comment on the waitUntil/after naming.)
  if (kid) {
    after(async () => {
      try {
        // recordAttempt (the attempt log) and getSubjectProfile (needed
        // for the memory-layer update below) are independent of each
        // other — same parallelization reasoning as elsewhere in this file.
        const [, current] = await Promise.all([
          recordAttempt(supabase, {
            kidId: kid.id,
            exerciseId: exercise.id,
            subject: exercise.subject,
            correct: evaluation.correct,
            errorNote: evaluation.errorNote,
            kidAnswer: answer,
            correctAnswer: exercise.correctAnswer,
            spokenLine: evaluation.feedback,
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
          tutorReply: evaluation.feedback,
          exercise: {
            topic: exercise.topic,
            correct: evaluation.correct,
            errorNote: evaluation.errorNote,
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

  return NextResponse.json({ evaluation, practice });
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
  { text, character }: SpeakBody,
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
    upstream = await synthesizeSpeech(text, character, signal);
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
