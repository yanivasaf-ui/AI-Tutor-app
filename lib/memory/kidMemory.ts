import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Per-kid episodic memory: the small, dated, citable facts that let the
 * character say "last week this was hard for you" instead of "כל הכבוד".
 *
 * WHY A NEW TABLE, given lib/memory/store.ts already exists:
 * `subject_profiles` is a rolling AGGREGATE — one row per kid per subject,
 * replaced on every update, holding deduped arrays and a prose summary. It
 * deliberately has no per-fact timestamp or provenance, so nothing in it can
 * answer "what happened yesterday" or be ranked by recency, which is exactly
 * what a continuity opener and specific praise need. `exercise_attempts` has
 * the timestamps but is raw per-attempt rows (question, answer, correct) —
 * injecting those into a prompt is the free-text dump this is meant to avoid.
 * So: a third grain, distilled and typed, derived from signals the other two
 * already produce rather than summarised independently.
 *
 * WHY NO LLM ON THE WRITE PATH: every fact below is derivable in code from
 * what the evaluation already returned (topic, correct, attempt number,
 * errorNote, level change). A second summariser call would add cost and
 * latency to the answer round trip for signal we already hold exactly.
 *
 * WHY `detail` IS ENGLISH: these strings are model input, never spoken
 * verbatim — the model rewrites them into Hebrew in the kid's own gender.
 * English keeps the block cheap in tokens and makes it impossible for a
 * stored phrase to leak into speech with the wrong grammatical gender.
 * `topic` stays the Hebrew kid-facing label, because that IS said aloud.
 */

type Client = SupabaseClient<Database>;

export type KidFactType = "win" | "struggle" | "preference" | "milestone";

export interface KidFact {
  factType: KidFactType;
  /** Kid-facing Hebrew topic label (MapTopic.displayNameKid) — spoken. */
  topic: string;
  /** Compact English descriptor — model input only, never spoken as-is. */
  detail: string;
  createdAt?: string;
}

/** Most facts a single answer may produce (brief: 1-3). */
const MAX_FACTS_PER_ANSWER = 3;

export interface AnswerSignals {
  topicLabel: string;
  correct: boolean;
  attempt: 1 | 2;
  /** The evaluator's own characterisation of the mistake, when it made one. */
  errorNote?: string;
  leveledUp?: boolean;
  topicCompleted?: boolean;
}

/**
 * One answer in, 0-3 facts out. Deterministic and pure, so the write path is
 * testable without a database and without a model.
 *
 * A first-try miss only becomes a fact when the evaluator actually
 * characterised it (`errorNote`): "got one wrong" is noise, "confused
 * addition with subtraction" is the thing worth citing three sessions later.
 */
export function factsFromAnswer(s: AnswerSignals): KidFact[] {
  const facts: KidFact[] = [];

  if (s.correct) {
    facts.push({
      factType: "win",
      topic: s.topicLabel,
      detail: s.attempt === 1 ? "solved it on the first try" : "got it on the second try, after one hint",
    });
  } else if (s.attempt === 2) {
    facts.push({
      factType: "struggle",
      topic: s.topicLabel,
      detail: s.errorNote ? `missed twice; ${s.errorNote}` : "missed twice, needed the full explanation",
    });
  } else if (s.errorNote) {
    facts.push({ factType: "struggle", topic: s.topicLabel, detail: s.errorNote });
  }

  if (s.leveledUp) {
    facts.push({ factType: "milestone", topic: s.topicLabel, detail: "moved up a difficulty level" });
  }
  if (s.topicCompleted) {
    facts.push({ factType: "milestone", topic: s.topicLabel, detail: "finished this topic on the journey map" });
  }

  return facts.slice(0, MAX_FACTS_PER_ANSWER);
}

/**
 * Appends facts for one kid. Never throws: memory is an enhancement, and a
 * failed write must not cost a child their feedback. Duplicate rows inside
 * one session are dropped by a unique index (23505 is expected, not an
 * error) so a retried request can't say the same thing twice.
 */
export async function saveKidFacts(
  supabase: Client,
  kidId: string,
  facts: KidFact[],
  sourceSessionId: string | null
): Promise<number> {
  if (facts.length === 0) return 0;
  const rows = facts.map((f) => ({
    kid_id: kidId,
    fact_type: f.factType,
    topic: f.topic,
    detail: f.detail,
    source_session_id: sourceSessionId,
  }));

  const { error, count } = await supabase.from("kid_memory").insert(rows, { count: "exact" });
  if (error) {
    if (error.code === "23505") return 0; // same fact, same session — by design
    console.error("[kid-memory] write failed:", error.message);
    return 0;
  }
  return count ?? rows.length;
}

/** How many facts the prompt may ever carry, and the budget they're trimmed to. */
export const MEMORY_FACT_LIMIT = 10;
export const MEMORY_BLOCK_MAX_CHARS = 600;

/**
 * The newest facts for ONE kid. The explicit kid_id filter is the app-level
 * half of the isolation guarantee — RLS already scopes rows to kids this
 * parent owns, but a parent owns several kids, so the query is what keeps one
 * sibling's history out of another's prompt.
 */
export async function recentKidFacts(
  supabase: Client,
  kidId: string,
  limit: number = MEMORY_FACT_LIMIT
): Promise<KidFact[]> {
  const { data, error } = await supabase
    .from("kid_memory")
    .select("fact_type, topic, detail, created_at")
    .eq("kid_id", kidId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) console.error("[kid-memory] read failed:", error.message);
    return [];
  }
  return data.map((r) => ({
    factType: r.fact_type as KidFactType,
    topic: r.topic as string,
    detail: r.detail as string,
    createdAt: r.created_at as string,
  }));
}

/** Whole days between a fact and now — what turns a fact into "yesterday". */
export function daysAgo(createdAt: string | undefined, now: Date = new Date()): number | null {
  if (!createdAt) return null;
  const then = new Date(createdAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

function whenLabel(days: number | null): string {
  if (days === null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 7) return `${days} days ago`;
  return "a while back";
}

// ---- scoped chat ---------------------------------------------------------

/**
 * feat: scoped kid chat — the onboarding conversation's fixed slots, in the
 * order the character works through them.
 *
 * The SLOT is what makes the fact write deterministic: the server owns the
 * script, so it always knows which question the kid is answering, and the
 * answer can be filed under that slot's topic without asking a model to
 * extract anything. The model writes the conversation; it never decides
 * what gets remembered.
 *
 * Name, gender and grade are deliberately NOT slots here — the onboarding
 * form already collects them as typed, validated values (kids.name /
 * .gender / .grade), and re-asking them in chat would both repeat a
 * question the kid just answered and require pulling a `Grade` enum out of
 * free text, which is exactly the extra model call this path forbids. The
 * character uses the name and grade it already has to personalise these
 * questions instead.
 */
export const ONBOARDING_SLOTS = [
  { key: "friend", topic: "חברים", factType: "preference" as const },
  { key: "hobby", topic: "תחביבים", factType: "preference" as const },
  { key: "school", topic: "בית ספר", factType: "preference" as const },
] as const;

export type ChatMode = "onboarding" | "checkin";

/** Hard ceiling on one chat, enforced by the server, not by the prompt. */
export const MAX_CHAT_EXCHANGES = 5;

/**
 * One kid turn in, at most one fact out — the chat half of the same
 * "derive, don't summarise" rule the exercise path uses.
 *
 * `slotIndex` is how many turns the kid has already taken, so it addresses
 * the slot being answered. Past the end of the script there is nothing left
 * to file, and a check-in turn files against the loop it reopened.
 */
export function factsFromChatTurn(
  mode: ChatMode,
  slotIndex: number,
  answer: string,
  checkinTopic?: string
): KidFact[] {
  const text = answer.trim();
  if (!text) return [];

  if (mode === "onboarding") {
    const slot = ONBOARDING_SLOTS[slotIndex];
    if (!slot) return [];
    return [{ factType: slot.factType, topic: slot.topic, detail: text }];
  }
  // check-in: the kid is telling us how an open loop actually went.
  return [{ factType: "preference", topic: checkinTopic ?? "צ'ק-אין", detail: text }];
}

/** Past this, "remember when..." stops sounding like continuity and starts
 *  sounding like a database. A fact older than this opens nothing. */
export const OPENER_MAX_AGE_DAYS = 14;

/** A loop the character has raised this recently is not open any more. */
export const LOOP_COOLDOWN_DAYS = 3;

export interface OpenLoop {
  id: string;
  factType: KidFactType;
  topic: string;
  detail: string;
}

/**
 * What the daily check-in has to talk about: this kid's facts that the
 * character has not raised recently — never-referenced first, then
 * longest-since-referenced.
 *
 * "Open" is derived rather than stored as its own row type: a friend or a
 * hobby from onboarding is open until it has been asked about, and a
 * struggle is open until a later win on the same topic closes it. The one
 * piece of real state is `last_referenced_at`, which is what stops the
 * character asking "איך היה עם דנה?" every day for a month.
 */
export async function openLoops(supabase: Client, kidId: string, limit = 3): Promise<OpenLoop[]> {
  const cutoff = new Date(Date.now() - LOOP_COOLDOWN_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("kid_memory")
    .select("id, fact_type, topic, detail, last_referenced_at, created_at")
    .eq("kid_id", kidId)
    .or(`last_referenced_at.is.null,last_referenced_at.lt.${cutoff}`)
    .order("last_referenced_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(30);

  if (error || !data) {
    if (error) console.error("[kid-memory] open loops read failed:", error.message);
    return [];
  }

  // A struggle with a later win on the same topic has closed itself.
  const wonTopics = new Set(
    data.filter((r) => r.fact_type === "win").map((r) => r.topic as string)
  );
  return data
    .filter((r) => !(r.fact_type === "struggle" && wonTopics.has(r.topic as string)))
    .filter((r) => r.fact_type !== "win" && r.fact_type !== "milestone")
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      factType: r.fact_type as KidFactType,
      topic: r.topic as string,
      detail: r.detail as string,
    }));
}

/** Stamps the loops the character actually raised, so they go quiet for
 *  LOOP_COOLDOWN_DAYS instead of coming back tomorrow. */
export async function markReferenced(supabase: Client, kidId: string, factIds: string[]): Promise<void> {
  if (factIds.length === 0) return;
  const { error } = await supabase
    .from("kid_memory")
    .update({ last_referenced_at: new Date().toISOString() })
    .eq("kid_id", kidId)
    .in("id", factIds);
  if (error) console.error("[kid-memory] marking loops referenced failed:", error.message);
}

export interface OpenerFact {
  factType: KidFactType;
  topic: string;
  /** 0 = today, 1 = yesterday. Already resolved here so the line layer
   *  never has to do date arithmetic. */
  daysAgo: number;
}

/**
 * The single fact worth opening a session with (feat: continuity greeting):
 * the newest one still recent enough to mean something. Newest-first is the
 * whole selection rule — a struggle from yesterday beats a win from last
 * week, because the point is to pick up where the kid actually left off.
 *
 * Returns null for a first session, or when everything on file has gone
 * stale, and the caller falls back to the generic greeting unchanged.
 */
export function pickOpenerFact(facts: KidFact[], now: Date = new Date()): OpenerFact | null {
  for (const f of facts) {
    const age = daysAgo(f.createdAt, now);
    if (age === null || age > OPENER_MAX_AGE_DAYS) continue;
    return { factType: f.factType, topic: f.topic, daysAgo: age };
  }
  return null;
}

/**
 * The memory block as it appears in a system prompt: a clearly delimited,
 * newest-first list, trimmed to a character budget (a stable proxy for a
 * token budget — Hebrew tokenises unevenly, characters don't). Returns ""
 * for a kid with no history, so callers can concatenate unconditionally and
 * a first session is byte-for-byte the prompt it was before this feature.
 */
export function formatMemoryBlock(facts: KidFact[], maxChars: number = MEMORY_BLOCK_MAX_CHARS): string {
  if (facts.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const f of facts) {
    const line = `- [${f.factType}] ${f.topic} — ${f.detail} (${whenLabel(daysAgo(f.createdAt))})`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return "";

  return `## מה שכבר קרה עם התלמיד/ה (זיכרון אישי, החדש ביותר ראשון)
${lines.join("\n")}
השתמש/י בעובדה קונקרטית אחת מכאן כשהיא רלוונטית, ובלשון הילד/ה. אל תקריא/י את הרשימה ואל תזכיר/י שיש לך "זיכרון".`;
}
