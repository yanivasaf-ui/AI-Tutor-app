import type { Exercise } from "./types";

/**
 * Hebrew topic leakage, measured from evidence rather than from anchors.
 *
 * WHY THIS IS NOT lib/exercises/topic-fit.ts. That module answers "does
 * this exercise use its topic's vocabulary", which works for maths because
 * a geometry exercise says "משולש". Hebrew topics are skills, not subject
 * matter: `hebrew-g-writing-process` and `hebrew-g-oral-expression` share
 * the whole language. There is no word whose presence proves belonging,
 * and a wrong anchor list would reject good exercises — which is why the
 * math check declares Hebrew unchecked rather than guessing.
 *
 * So this module measures something a machine CAN decide from the bank
 * itself, with no invented vocabulary:
 *
 *   An identical question filed under more than one topic cannot belong
 *   to all of them.
 *
 * That is a proof of mis-filing, and it needs no opinion about what any
 * topic is "about". It is a LOWER BOUND — it sees only exact duplicates,
 * so a paraphrase of the same drill under five topics is invisible to it.
 *
 * What it deliberately does NOT do is decide WHICH of the filings is the
 * right one. Nothing in the duplicate evidence says whether
 * "איזו מילה נגזרת מהשורש ק-ר-א?" belongs to vocabulary or to
 * reading-comprehension or to neither, so this module reports every copy
 * and leaves that judgement to a person.
 */

/** Normalised so trivial whitespace differences do not hide a duplicate. */
export function questionKey(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

export interface DuplicateGroup {
  question: string;
  /** Every topic this exact question is filed under, sorted. */
  topics: string[];
  /** Every row id carrying it. */
  ids: string[];
}

export interface TopicAudit {
  topicId: string;
  total: number;
  /** Rows whose question is also filed under a different topic. */
  shared: number;
  /** shared / total, 0..1. */
  ratio: number;
}

export interface HebrewAudit {
  rows: number;
  /** Distinct questions filed under more than one topic. */
  duplicateQuestions: number;
  /** Rows carrying one of those questions. */
  flaggedRows: number;
  /** The most-shared questions first. */
  groups: DuplicateGroup[];
  byTopic: TopicAudit[];
}

type Row = Pick<Exercise, "id" | "question"> & { topicId: string | null };

/**
 * The audit. Pure, so the numbers in the report and the numbers the tests
 * assert come from the same code.
 */
export function auditHebrewTopics(rows: readonly Row[]): HebrewAudit {
  const byQuestion = new Map<string, { topics: Set<string>; ids: string[]; question: string }>();
  for (const r of rows) {
    if (!r.topicId) continue;
    const key = questionKey(r.question);
    const entry = byQuestion.get(key) ?? { topics: new Set<string>(), ids: [], question: key };
    entry.topics.add(r.topicId);
    entry.ids.push(r.id);
    byQuestion.set(key, entry);
  }

  const groups: DuplicateGroup[] = [];
  const flaggedKeys = new Set<string>();
  for (const [key, e] of byQuestion) {
    if (e.topics.size < 2) continue;
    flaggedKeys.add(key);
    groups.push({ question: e.question, topics: [...e.topics].sort(), ids: e.ids });
  }
  groups.sort((a, b) => b.topics.length - a.topics.length || a.question.localeCompare(b.question));

  const totals = new Map<string, { total: number; shared: number }>();
  let flaggedRows = 0;
  for (const r of rows) {
    if (!r.topicId) continue;
    const t = totals.get(r.topicId) ?? { total: 0, shared: 0 };
    t.total++;
    if (flaggedKeys.has(questionKey(r.question))) {
      t.shared++;
      flaggedRows++;
    }
    totals.set(r.topicId, t);
  }

  const byTopic: TopicAudit[] = [...totals]
    .map(([topicId, t]) => ({ topicId, total: t.total, shared: t.shared, ratio: t.total ? t.shared / t.total : 0 }))
    .sort((a, b) => b.shared - a.shared || a.topicId.localeCompare(b.topicId));

  return { rows: rows.filter((r) => r.topicId).length, duplicateQuestions: groups.length, flaggedRows, groups, byTopic };
}

/**
 * Does `subtype` distinguish anything in this bank?
 *
 * The question matters because the obvious alternative definition of
 * Hebrew belonging is "which exercise KINDS belong to which topic" — and
 * this answers whether the bank contains the evidence to build one. If a
 * subtype appears under every topic, it separates nothing, and a mapping
 * built from this bank would be invention rather than measurement.
 */
export function subtypeSpread(rows: readonly (Row & { subtype?: string | null; type?: string })[]): {
  subtype: string;
  topics: number;
}[] {
  const spread = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.topicId) continue;
    const kind = r.subtype ?? r.type ?? "(none)";
    const s = spread.get(kind) ?? new Set<string>();
    s.add(r.topicId);
    spread.set(kind, s);
  }
  return [...spread]
    .map(([subtype, topics]) => ({ subtype, topics: topics.size }))
    .sort((a, b) => b.topics - a.topics || a.subtype.localeCompare(b.subtype));
}
