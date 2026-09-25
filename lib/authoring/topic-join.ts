import type { SlotTopicId } from "./rubric";

/**
 * The explicit join between the product's 22 math topic ids
 * (lib/map/topics.ts) and the Ministry corpus's two taxonomies
 * (data/corpus/):
 *
 *  - `ministry`: cells of topic-skill-map.json (grade letter → ministry
 *    slug), the ציוני דרך milestone documents — the curriculum's own
 *    topic → skill statements.
 *  - `corpusTopics`: the `topic` slugs that corpus ITEMS carry
 *    (items/*.json) — keyword-classified per item by the corpus builder,
 *    coarser and different from the ministry slugs.
 *
 * Hand-written, not auto-mapped, as the corpus README asks. Every row says
 * why; every gap is written down rather than papered over.
 *
 * NOTE on "כפל וחילוק": the README says the product topic "spans
 * multiplication + division slugs". Those are ITEM topic slugs. In
 * topic-skill-map.json there is no multiplication or division cell at any
 * grade — both live inside the operations cell `Peulot` (ב/Peulot has 16
 * mult/div skill statements, ג/Peulot 21). So the ג row below joins ONE
 * ministry cell and BOTH item slugs.
 *
 * Unjoined on purpose (no product topic teaches them): ministry cells
 * ב/Harchava and ג/Harchava (enrichment), ג/Shvarim (fractions),
 * ג/Transform (transformations), and all of grade ד; item topics
 * `fractions` and `general` (general = no confident topic signal, 62% of
 * items). Corpus grades 4-5 have no product grade.
 */

export type CorpusTopic =
  | "numbers_place_value"
  | "addition_subtraction"
  | "multiplication"
  | "division"
  | "fractions"
  | "geometry"
  | "measurement"
  | "patterns_sequences"
  | "general";

export interface MinistryCell {
  /** topic-skill-map.json grade key. */
  grade: "א" | "ב" | "ג" | "ד";
  /** Slug under that grade. */
  slug: string;
}

export interface TopicJoin {
  productTopicId: SlotTopicId;
  grade: "א" | "ב" | "ג";
  ministry: MinistryCell[];
  /** Item topics, at the same grade, whose items speak to this topic. */
  corpusTopics: CorpusTopic[];
  why: string;
}

export const TOPIC_JOIN: readonly TopicJoin[] = [
  // ---------------------------------------------------------------- grade א
  {
    productTopicId: "math-a-numbers-0-100", grade: "א",
    ministry: [{ grade: "א", slug: "MisparimTivyim" }],
    corpusTopics: ["numbers_place_value", "patterns_sequences"],
    why: "מספרים טבעיים; the product topic's own text includes counting in jumps and sequences (חוקיות), hence patterns_sequences",
  },
  {
    productTopicId: "math-a-addition-subtraction", grade: "א",
    ministry: [{ grade: "א", slug: "Peulot" }],
    corpusTopics: ["addition_subtraction"],
    why: "פעולות במספרים טבעיים. The cell also holds 3 repeated-addition-as-multiplication skills the product topic does not teach (see operations in lib/map/topics.ts), so multiplication items are NOT joined",
  },
  {
    productTopicId: "math-a-geometry", grade: "א",
    ministry: [{ grade: "א", slug: "Geometriya" }],
    corpusTopics: ["geometry"],
    why: "גאומטריה",
  },
  {
    productTopicId: "math-a-length", grade: "א",
    ministry: [{ grade: "א", slug: "Medidot" }],
    corpusTopics: ["measurement"],
    why: "מידות ומדידה. Item topic `measurement` does not separate length from time",
  },
  {
    productTopicId: "math-a-time", grade: "א",
    ministry: [{ grade: "א", slug: "Medidot" }],
    corpusTopics: ["measurement"],
    why: "מידות ומדידה (time skills live in this cell). Item topic `measurement` does not separate time from length",
  },
  {
    productTopicId: "math-a-data", grade: "א",
    ministry: [],
    corpusTopics: [],
    why: "GAP: topic-skill-map has no Netunim (data) cell for grade א, and no item topic covers data",
  },
  // ---------------------------------------------------------------- grade ב
  {
    productTopicId: "math-b-numbers-0-1000", grade: "ב",
    ministry: [{ grade: "ב", slug: "MisparimTivyim" }],
    corpusTopics: ["numbers_place_value", "patterns_sequences"],
    why: "מספרים טבעיים, including its sequence skills",
  },
  {
    productTopicId: "math-b-arithmetic", grade: "ב",
    ministry: [{ grade: "ב", slug: "Peulot" }],
    corpusTopics: ["addition_subtraction", "multiplication", "division"],
    why: "פעולות במספרים טבעיים — the product topic is 'חיבור, חיסור, ותחילת כפל וחילוק', and ב/Peulot carries both division meanings (חילוק לחלקים וחילוק להכלה)",
  },
  {
    productTopicId: "math-b-geometry", grade: "ב",
    ministry: [{ grade: "ב", slug: "Geometriya" }],
    corpusTopics: ["geometry"],
    why: "גאומטריה",
  },
  {
    productTopicId: "math-b-length", grade: "ב",
    ministry: [{ grade: "ב", slug: "Medidot" }],
    corpusTopics: ["measurement"],
    why: "מידות ומדידה",
  },
  {
    productTopicId: "math-b-volume", grade: "ב",
    ministry: [{ grade: "ב", slug: "Geometriya" }, { grade: "ב", slug: "Medidot" }],
    corpusTopics: ["geometry", "measurement"],
    why: "'גופים ומדידות נפח': solids are skills in ב/Geometriya (6 גופים statements), volume measurement in ב/Medidot",
  },
  {
    productTopicId: "math-b-time", grade: "ב",
    ministry: [{ grade: "ב", slug: "Medidot" }],
    corpusTopics: ["measurement"],
    why: "מידות ומדידה (time skills live in this cell)",
  },
  {
    productTopicId: "math-b-data", grade: "ב",
    ministry: [{ grade: "ב", slug: "Netunim" }],
    corpusTopics: [],
    why: "נתונים. GAP: no item topic covers data",
  },
  // ---------------------------------------------------------------- grade ג
  {
    productTopicId: "math-g-numbers-0-10000", grade: "ג",
    ministry: [{ grade: "ג", slug: "MisparimTivyim" }],
    corpusTopics: ["numbers_place_value", "patterns_sequences"],
    why: "מספרים טבעיים",
  },
  {
    productTopicId: "math-g-gematria", grade: "ג",
    ministry: [],
    corpusTopics: [],
    why: "GAP: no ג cell mentions gematria (the one gematria skill is ב/MisparimTivyim 'ידע לחשב ערכי מילים בגימטרייה', a grade earlier); no item topic covers it",
  },
  {
    productTopicId: "math-g-arithmetic", grade: "ג",
    ministry: [{ grade: "ג", slug: "Peulot" }],
    corpusTopics: ["addition_subtraction"],
    why: "פעולות במספרים טבעיים, the addition/subtraction/estimation part (the product topic excludes ×/÷)",
  },
  {
    productTopicId: "math-g-multiplication-division", grade: "ג",
    ministry: [{ grade: "ג", slug: "Peulot" }],
    corpusTopics: ["multiplication", "division"],
    why: "'כפל וחילוק' spans BOTH item slugs; in the ministry map both live in the one Peulot cell (21 mult/div skills) — there is no separate ministry slug for either",
  },
  {
    productTopicId: "math-g-geometry", grade: "ג",
    ministry: [{ grade: "ג", slug: "Geometriya" }],
    corpusTopics: ["geometry"],
    why: "גאומטריה (angles and triangles are skills here)",
  },
  {
    productTopicId: "math-g-area", grade: "ג",
    ministry: [{ grade: "ג", slug: "Medidot" }],
    corpusTopics: ["measurement"],
    why: "מידות ומדידה (area skills). Item topic `measurement` does not separate area",
  },
  {
    productTopicId: "math-g-volume", grade: "ג",
    ministry: [{ grade: "ג", slug: "Medidot" }, { grade: "ג", slug: "Geometriya" }],
    corpusTopics: ["measurement", "geometry"],
    why: "'גופים ומדידות נפח': 9 volume statements in ג/Medidot, solids in ג/Geometriya",
  },
  {
    productTopicId: "math-g-time", grade: "ג",
    ministry: [{ grade: "ג", slug: "Medidot" }],
    corpusTopics: ["measurement"],
    why: "מידות ומדידה (time skills live in this cell)",
  },
  {
    productTopicId: "math-g-data", grade: "ג",
    ministry: [{ grade: "ג", slug: "Netunim" }],
    corpusTopics: [],
    why: "נתונים. GAP: no item topic covers data",
  },
];

export function joinFor(topicId: string): TopicJoin | undefined {
  return TOPIC_JOIN.find((j) => j.productTopicId === topicId);
}

/** Corpus grade letter → grade_num (items carry both). */
export const GRADE_NUM: Readonly<Record<"א" | "ב" | "ג", number>> = { א: 1, ב: 2, ג: 3 };
