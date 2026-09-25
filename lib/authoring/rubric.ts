/**
 * The question-authoring rubric: what a question has to be before a child
 * sees it. Sits beside the feedback constitution (lib/feedback/
 * constitution.ts), which owns what the character says ABOUT the child's
 * work; this owns the question itself.
 *
 * WHY. Live click-through on 2026-09-25 showed the generator had no
 * content standard at all — a growing series told as a count ("הנה כמה
 * צדפים יש לה: 3, 6, 9, 12"), a division question with no sharing or
 * grouping to hold on to, division served under a grade that has none.
 * Every existing gate checks that an exercise agrees with ITSELF (bank-
 * guard.ts) or with its topic's vocabulary (topic-fit.ts); nothing checked
 * that it is a good question.
 *
 * TWO LAYERS, deliberately separate:
 *
 * 1. UNIVERSAL_RULES — the standard every math question meets, whatever
 *    its grade or topic. These are the brief's own rules, stated once.
 *    Each says how it is enforced: `deterministic` rules are checked in
 *    code by lib/authoring/quality-gate.ts; `review` rules need judgment
 *    and are left to the model self-review step there.
 *
 * 2. SLOTS — per-topic phrasing rules and exemplar questions. These are
 *    NOT written here. They are filled from the Ministry corpus
 *    (data/corpus/, digests/ + items/) so the standard for "how a grade-ב
 *    division question sounds" is how the Ministry's own books phrase it,
 *    not how this file's author imagines it. A slot the corpus cannot fill
 *    stays marked as such rather than being guessed.
 *
 * No runtime imports beyond types: this module is read by the generator,
 * the quality gate, and tests, and must not pull the Anthropic SDK in.
 */

// ---------------------------------------------------------------- rules

export type RuleId =
  | "spoken-hebrew"
  | "one-task"
  | "concrete-scenario"
  | "sequence-anchored"
  | "division-sharing-frame"
  | "no-series-as-count"
  | "internal-consistency"
  | "unambiguous-answer";

export interface AuthoringRule {
  id: RuleId;
  /** The rule as it is given to a model (generation and review prompts). */
  he: string;
  /** How it is enforced. `deterministic` = code in quality-gate.ts;
   *  `review` = model self-review only. A rule can be partly both — the
   *  code catches the shapes it can, review catches the rest. */
  enforcement: ("deterministic" | "review")[];
}

export const UNIVERSAL_RULES: readonly AuthoringRule[] = [
  {
    id: "spoken-hebrew",
    he: "עברית מדוברת ופשוטה שמתאימה לגיל הילד/ה — משפטים קצרים ומילים שילד/ה בכיתה הזו אומר/ת בעצמו/ה.",
    enforcement: ["review"],
  },
  {
    id: "one-task",
    he: "משימה אחת ברורה בכל שאלה — שאלה אחת, לא שתיים או שלוש שמחכות לתשובה.",
    enforcement: ["deterministic", "review"],
  },
  {
    id: "concrete-scenario",
    he: "תרחיש מוחשי שילד/ה יכול/ה לדמיין ולמפות לעולם שלו/ה — חפצים, אנשים ומקומות מוכרים.",
    enforcement: ["review"],
  },
  {
    id: "sequence-anchored",
    he: "סדרה או רצף מעוגנים בזמן או בשלבים (יום אחרי יום, קפיצה אחרי קפיצה, קומה אחרי קומה) או מוצגים במפורש כרצף להמשיך.",
    enforcement: ["deterministic", "review"],
  },
  {
    id: "division-sharing-frame",
    he: "חילוק תמיד מוצג כחלוקה שווה לקבוצות שיש להן שם (סלים, ילדים, קופסאות) — או כחלוקה לקבוצות בגודל ידוע — ולעולם לא כתרגיל חילוק חשוף בלי מסגרת.",
    enforcement: ["deterministic", "review"],
  },
  {
    id: "no-series-as-count",
    he: "לעולם לא להציג סדרה של מספרים כאילו היא כמות אחת שקיימת עכשיו (\"יש לה: 3, 6, 9, 12\").",
    enforcement: ["deterministic"],
  },
  {
    id: "internal-consistency",
    he: "המספרים, היחידות והחפצים עקביים לאורך כל השאלה — מה שנאמר בטקסט הוא מה שמוצג, ומה שמוצג הוא מה שנספר.",
    enforcement: ["deterministic", "review"],
  },
  {
    id: "unambiguous-answer",
    he: "התשובה הצפויה חד-משמעית — ברור מה נשאל, ויש תשובה נכונה אחת.",
    enforcement: ["deterministic", "review"],
  },
];

export function ruleById(id: RuleId): AuthoringRule {
  const rule = UNIVERSAL_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown authoring rule ${id}`);
  return rule;
}

// ---------------------------------------------------------------- slots

/**
 * Where a slot's content stands. `placeholder`: not filled yet.
 * `filled`: filled from the corpus, with provenance. `insufficient-
 * evidence`: the corpus was consulted and has too little (or only low-
 * fidelity material) for this slice — deliberately left empty rather than
 * invented.
 */
export type SlotStatus = "placeholder" | "filled" | "insufficient-evidence";

/** One phrasing pattern as the corpus observed it for a grade × topic:
 *  the corpus's own label and how often it occurs. Data, not prose. */
export interface ObservedPattern {
  label: string;
  count: number;
  /** count / items in the slice, 0..1, rounded to 2 places. */
  share: number;
}

export interface PhrasingSlot {
  status: SlotStatus;
  /** Most frequent first. */
  patterns?: ObservedPattern[];
  /** Item-type counts in the slice (word_problem, direct_question, ...). */
  types?: Record<string, number>;
  /** Which digest sections the numbers came from. */
  source?: { digest: string; sections: string[] }[];
  note?: string;
}

export interface CorpusProvenance {
  id: string;
  series: string;
  url: string;
  /** Textbook items have volume + page; monthly worksheets have a document. */
  volume?: string;
  page?: number;
  document?: string;
}

export interface Exemplar {
  /** Verbatim corpus text, niqqud preserved. */
  text: string;
  niqqud: boolean;
  type: string;
  source: CorpusProvenance;
}

export interface ExemplarSlot {
  status: SlotStatus;
  exemplars?: Exemplar[];
  note?: string;
}

export interface TopicSlots {
  phrasing: PhrasingSlot;
  exemplars: ExemplarSlot;
}

/**
 * The math topics a slot exists for — every product math topic
 * (lib/map/topics.ts). Hebrew topics have no slots: the corpus is math
 * only, and the universal rules above are written for math questions.
 */
export const SLOT_TOPIC_IDS = [
  "math-a-numbers-0-100",
  "math-a-addition-subtraction",
  "math-a-geometry",
  "math-a-length",
  "math-a-time",
  "math-a-data",
  "math-b-numbers-0-1000",
  "math-b-arithmetic",
  "math-b-geometry",
  "math-b-length",
  "math-b-volume",
  "math-b-time",
  "math-b-data",
  "math-g-numbers-0-10000",
  "math-g-gematria",
  "math-g-arithmetic",
  "math-g-multiplication-division",
  "math-g-geometry",
  "math-g-area",
  "math-g-volume",
  "math-g-time",
  "math-g-data",
] as const;
export type SlotTopicId = (typeof SLOT_TOPIC_IDS)[number];

/** Two rules cut across topics — a sequence or a division can turn up in
 *  any of them — so they get slots of their own, per grade. */
export type CrossCuttingSlot = "sequences" | "division";

const PLACEHOLDER: TopicSlots = {
  phrasing: { status: "placeholder" },
  exemplars: { status: "placeholder" },
};

/** Per-topic slots. PLACEHOLDER until filled from the corpus. */
export const TOPIC_SLOTS: Readonly<Record<SlotTopicId, TopicSlots>> = Object.fromEntries(
  SLOT_TOPIC_IDS.map((id) => [id, PLACEHOLDER])
) as Record<SlotTopicId, TopicSlots>;

/** Cross-cutting slots, per product grade. PLACEHOLDER until filled. */
export const CROSS_CUTTING_SLOTS: Readonly<Record<CrossCuttingSlot, Record<"א" | "ב" | "ג", TopicSlots>>> = {
  sequences: { א: PLACEHOLDER, ב: PLACEHOLDER, ג: PLACEHOLDER },
  division: { א: PLACEHOLDER, ב: PLACEHOLDER, ג: PLACEHOLDER },
};

export function slotsFor(topicId: string): TopicSlots | undefined {
  return (TOPIC_SLOTS as Record<string, TopicSlots>)[topicId];
}
