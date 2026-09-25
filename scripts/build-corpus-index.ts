/**
 * Builds lib/authoring/corpus-slots.json — the small, runtime-safe slice of
 * the Ministry corpus (data/corpus/, 19MB, never read at runtime) that the
 * authoring rubric and the quality gate consult:
 *
 *  - PHRASING per product math topic: the digest's own phrasing-pattern and
 *    item-type counts for the item topics the join (lib/authoring/topic-
 *    join.ts) assigns it, summed across those digest sections. Data, not
 *    prose — no phrasing rule is written by hand.
 *  - EXEMPLARS per product math topic: verbatim corpus questions, picked by
 *    id (EXEMPLAR_PICKS — see there for why not by filter). Every pick is
 *    verified HIGH-fidelity (word_problem/direct_question — never drill)
 *    and free of the extraction artifacts data/CORPUS-INGEST.md lists.
 *  - CROSS-CUTTING sequences/division per grade, from the
 *    patterns_sequences / division digest sections the same way.
 *  - VETTED TEMPLATES: the hand-picked items listed in TEMPLATE_PICKS
 *    below, with their text copied verbatim from the corpus and a
 *    computation code evaluates.
 *
 * A slice with too little to go on is written as insufficient-evidence,
 * not filled from somewhere else. Deterministic: same corpus, same output
 * (tests/corpus-slots.test.mts rebuilds and compares).
 *
 * Run: npx tsx scripts/build-corpus-index.ts [--check]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOPIC_JOIN, type CorpusTopic } from "../lib/authoring/topic-join";
import type { CorpusProvenance, Exemplar, ExemplarSlot, ObservedPattern, PhrasingSlot, TopicSlots } from "../lib/authoring/rubric";
import type { Computation } from "../lib/exercises/arithmetic";

const ROOT = new URL("../", import.meta.url).pathname;
const CORPUS = join(ROOT, "data/corpus");
const OUT = join(ROOT, "lib/authoring/corpus-slots.json");

interface Item {
  id: string;
  source: { series: string; publisher: string; url: string; volume?: string; page?: number; document?: string };
  grade: string;
  grade_num: number;
  topic: CorpusTopic;
  type: string;
  text: string;
  niqqud: boolean;
  phrasing_patterns: string[];
}

/** Fewer items than this in a slice and the pattern shares mean nothing. */
const MIN_SLICE_ITEMS = 10;
const HIGH_FIDELITY = new Set(["word_problem", "direct_question"]);
const GRADE_LETTER: Record<number, "א" | "ב" | "ג"> = { 1: "א", 2: "ב", 3: "ג" };

// ---------------------------------------------------------------- digests

interface DigestSection {
  topic: CorpusTopic;
  items: number;
  types: Record<string, number>;
  patterns: Record<string, number>;
  stems: { text: string; ref: string }[];
  heading: string;
}

const KNOWN_PATTERNS = [
  "bare computation / instruction",
  "named-child story + כמה question",
  "imperative plural instruction (כתבו/השלימו/הקיפו/סמנו/פתרו)",
  "metacognition prompt (איך מצאתם/הסבירו/בדקו)",
  "compare (מי יותר/פחות)",
  "completion to round ten/hundred",
  "show your work (הציגו את דרך הפתרון)",
  "open task (multiple answers)",
];

function parseDigest(gradeNum: number): DigestSection[] {
  const md = readFileSync(join(CORPUS, `digests/phrasing-grade-${gradeNum}.md`), "utf8");
  const sections: DigestSection[] = [];
  let cur: DigestSection | null = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^## .*\((\w+)\) — (\d+) items$/);
    if (h) {
      cur = { topic: h[1] as CorpusTopic, items: Number(h[2]), types: {}, patterns: {}, stems: [], heading: line.slice(3) };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("Types: ")) {
      for (const part of line.slice(7).split(", ")) {
        const [k, v] = part.split(":");
        cur.types[k] = Number(v);
      }
    } else if (line.startsWith("Patterns: ")) {
      for (const label of KNOWN_PATTERNS) {
        const m = line.match(new RegExp(`${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} \\((\\d+)\\)`));
        if (m) cur.patterns[label] = Number(m[1]);
      }
    } else {
      const s = line.match(/^> (.*?)\s+— \[(.+?)\]\s*$/);
      if (s) cur.stems.push({ text: s[1].trim(), ref: s[2] });
    }
  }
  return sections;
}

// ---------------------------------------------------------------- fidelity

/** Free of every extraction artifact data/CORPUS-INGEST.md lists, and one
 *  question long. Never alters the text — it only decides whether to use it. */
function isCleanQuestion(text: string): boolean {
  return (
    text.normalize("NFC") === text &&
    !text.includes("http") &&
    !/[A-Za-z]{3,}/.test(text) &&
    !/\s[ְ-ׇ]/.test(text) &&
    !text.includes(" ־") &&
    !/(?<!\d)0(360|180|90)(?!\d)/.test(text) &&
    !/(?<!\d)0\d{2,},|(?<!\d)0{2,3},\d/.test(text) &&
    (text.match(/\?/g) ?? []).length === 1 &&
    text.length >= 20 &&
    text.length <= 200
  );
}

function provenance(i: Item): CorpusProvenance {
  const p: CorpusProvenance = { id: i.id, series: i.source.series, url: i.source.url };
  if (i.source.volume) p.volume = i.source.volume;
  if (typeof i.source.page === "number") p.page = i.source.page;
  if (i.source.document) p.document = i.source.document;
  return p;
}

function exemplar(i: Item): Exemplar {
  return { text: i.text, niqqud: i.niqqud, type: i.type, source: provenance(i) };
}

// ---------------------------------------------------------------- slots

const items: Item[] = JSON.parse(readFileSync(join(CORPUS, "items/all-items.json"), "utf8"));
const digests: Record<number, DigestSection[]> = { 1: parseDigest(1), 2: parseDigest(2), 3: parseDigest(3) };

function phrasingSlot(gradeNum: number, topics: CorpusTopic[]): PhrasingSlot {
  const sections = digests[gradeNum].filter((s) => topics.includes(s.topic));
  if (topics.length === 0) return { status: "insufficient-evidence", note: "no corpus item topic is joined to this product topic" };
  const total = sections.reduce((a, s) => a + s.items, 0);
  if (total < MIN_SLICE_ITEMS) {
    return {
      status: "insufficient-evidence",
      note: `only ${total} corpus items in ${topics.join(" + ")} at grade ${GRADE_LETTER[gradeNum]} (need ${MIN_SLICE_ITEMS})`,
      source: [{ digest: `digests/phrasing-grade-${gradeNum}.md`, sections: sections.map((s) => s.heading) }],
    };
  }
  const counts: Record<string, number> = {};
  const types: Record<string, number> = {};
  for (const s of sections) {
    for (const [k, v] of Object.entries(s.patterns)) counts[k] = (counts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.types)) types[k] = (types[k] ?? 0) + v;
  }
  const patterns: ObservedPattern[] = Object.entries(counts)
    .map(([label, count]) => ({ label, count, share: Math.round((count / total) * 1000) / 1000 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    status: "filled",
    patterns,
    types: Object.fromEntries(Object.entries(types).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    source: [{ digest: `digests/phrasing-grade-${gradeNum}.md`, sections: sections.map((s) => s.heading) }],
  };
}

/**
 * Exemplars are PICKED, by id, from items read one by one — not selected by
 * a filter. On 2026-09-25 every automatic selection tried (digest stems;
 * high-fidelity types; artifact filters; the corpus's own "named-child story
 * + כמה" label) still returned mostly fragments: questions that point at a
 * figure ("באילו מספרים פגע?"), running headers fused into the text
 * ("החיבור לוח ד."), or items that lean on the previous item ("לשי היו
 * שקלים" — the number is in the item before). A generation prompt given
 * those would learn the fragments.
 *
 * So each pick below is a self-contained question a child could be asked as
 * is. Picks may come from the `general` item topic (62% of the corpus, "no
 * confident topic signal"), where most real word problems sit; each pick
 * records its corpus topic. The builder still verifies every pick is high
 * fidelity and artifact-free. A slot with no pick is insufficient-evidence.
 */
const EXEMPLAR_PICKS: Record<string, string[]> = {
  "math-b-arithmetic": ["psahot-b1-p40-167", "psahot-b2-p17-59", "psahot-b2-p94-515", "psahot-b3-p85-520"],
  "math-g-arithmetic": ["psahot-g1-p15-85"],
  "math-g-multiplication-division": ["psahot-g1-p81-513", "psahot-g3-p111-701"],
  "division/ב": ["psahot-b2-p94-515", "psahot-b3-p85-520"],
  "division/ג": ["psahot-g1-p81-513", "psahot-g3-p111-701"],
};

/** Picks whose keyword-classified item topic is wrong, with why. The corpus
 *  README: "topic field is keyword-classified per item". Recorded, not
 *  corrected in the corpus. */
const MISCLASSIFIED: Record<string, string> = {
  "psahot-g1-p15-85": "a subtraction word problem (67 → 100 שקלים) classified measurement for the word שקלים",
};

const NO_PICK_NOTE =
  "reviewed 2026-09-25: no self-contained, artifact-free question in this slice (fragments that depend on a figure, fused running headers, or context from a previous item)";

function exemplarSlot(slotKey: string, gradeNum: number, topics: CorpusTopic[]): ExemplarSlot {
  if (topics.length === 0) return { status: "insufficient-evidence", note: "no corpus item topic is joined to this product topic" };
  const picks = EXEMPLAR_PICKS[slotKey] ?? [];
  if (picks.length === 0) return { status: "insufficient-evidence", note: NO_PICK_NOTE };
  return {
    status: "filled",
    exemplars: picks.map((id) => {
      const i = items.find((x) => x.id === id);
      if (!i) throw new Error(`exemplar ${id} is not in the corpus`);
      if (i.grade_num !== gradeNum) throw new Error(`exemplar ${id} is grade ${i.grade}, slot ${slotKey} is not`);
      if (!HIGH_FIDELITY.has(i.type)) throw new Error(`exemplar ${id} is ${i.type} — only word_problem/direct_question may be exemplars`);
      if (!isCleanQuestion(i.text)) throw new Error(`exemplar ${id} carries an extraction artifact`);
      if (i.topic !== "general" && !topics.includes(i.topic) && !MISCLASSIFIED[id]) {
        throw new Error(`exemplar ${id} is ${i.topic}, outside ${slotKey}'s join`);
      }
      return exemplar(i);
    }),
  };
}

const topics: Record<string, TopicSlots> = {};
for (const j of TOPIC_JOIN) {
  const g = { א: 1, ב: 2, ג: 3 }[j.grade];
  topics[j.productTopicId] = {
    phrasing: phrasingSlot(g, j.corpusTopics),
    exemplars: exemplarSlot(j.productTopicId, g, j.corpusTopics),
  };
}

const crossCutting: Record<string, Record<string, TopicSlots>> = { sequences: {}, division: {} };
for (const g of [1, 2, 3]) {
  const L = GRADE_LETTER[g];
  crossCutting.sequences[L] = { phrasing: phrasingSlot(g, ["patterns_sequences"]), exemplars: exemplarSlot(`sequences/${L}`, g, ["patterns_sequences"]) };
  crossCutting.division[L] = { phrasing: phrasingSlot(g, ["division"]), exemplars: exemplarSlot(`division/${L}`, g, ["division"]) };
}

// ---------------------------------------------------------------- templates

/**
 * The vetted fallback templates: Ministry questions picked by hand, each
 * with the computation that answers it (evaluated in code, never stated
 * by a model). Chosen for: high-fidelity type, no extraction artifact, a
 * single unambiguous numeric answer, and passing the authoring gate. The
 * one presentation change: a leading list marker ("ב. ", "ד. ") is
 * dropped — it numbers the item on the book page, not the question.
 */
const TEMPLATE_PICKS: { id: string; topicId: string; computation: Computation; difficulty: 1 | 2 | 3 }[] = [
  // ב — division, both meanings (חילוק להכלה, חילוק לחלקים), then subtraction
  { id: "psahot-b2-p94-515", topicId: "math-b-arithmetic", computation: { operands: [9, 3], operators: ["/"] }, difficulty: 1 },
  { id: "psahot-b3-p85-520", topicId: "math-b-arithmetic", computation: { operands: [16, 4], operators: ["/"] }, difficulty: 2 },
  { id: "psahot-b1-p40-167", topicId: "math-b-arithmetic", computation: { operands: [14, 8], operators: ["-"] }, difficulty: 1 },
  { id: "psahot-b2-p136-744", topicId: "math-b-arithmetic", computation: { operands: [60, 47], operators: ["-"] }, difficulty: 2 },
  // ג — addition/subtraction
  { id: "psahot-g1-p15-85", topicId: "math-g-arithmetic", computation: { operands: [100, 67], operators: ["-"] }, difficulty: 2 },
  // ג — division by grouping (חילוק להכלה)
  { id: "psahot-g1-p80-498", topicId: "math-g-multiplication-division", computation: { operands: [80, 10], operators: ["/"] }, difficulty: 1 },
  { id: "psahot-g1-p80-501", topicId: "math-g-multiplication-division", computation: { operands: [100, 10], operators: ["/"] }, difficulty: 2 },
];

const LIST_MARKER = /^[א-ת\d][֑-ׇ]?\s?\.\s*/;

const templates = TEMPLATE_PICKS.map((p) => {
  const i = items.find((x) => x.id === p.id);
  if (!i) throw new Error(`template ${p.id} is not in the corpus`);
  if (!HIGH_FIDELITY.has(i.type)) throw new Error(`template ${p.id} is ${i.type}, not high fidelity`);
  if (!isCleanQuestion(i.text)) throw new Error(`template ${p.id} carries an extraction artifact`);
  return {
    topicId: p.topicId,
    question: i.text.replace(LIST_MARKER, ""),
    computation: p.computation,
    difficulty: p.difficulty,
    provenance: provenance(i),
  };
});

// ---------------------------------------------------------------- write

const manifest = readFileSync(join(ROOT, "data/corpus.sha256"));
const out = {
  corpusManifestSha256: createHash("sha256").update(manifest).digest("hex"),
  topics,
  crossCutting,
  templates,
};
const json = JSON.stringify(out, null, 1) + "\n";

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== json) {
    console.error("lib/authoring/corpus-slots.json is stale — run npx tsx scripts/build-corpus-index.ts");
    process.exit(1);
  }
  console.log("corpus-slots.json is up to date");
} else {
  writeFileSync(OUT, json);
  const filled = (k: "phrasing" | "exemplars") => Object.values(topics).filter((t) => t[k].status === "filled").length;
  console.log(
    `wrote ${OUT}: ${json.length} bytes; phrasing filled ${filled("phrasing")}/22, exemplars filled ${filled("exemplars")}/22, ${templates.length} templates`
  );
}
