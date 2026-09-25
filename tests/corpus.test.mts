/**
 * The Ministry math corpus (data/corpus/), ingested as-is from
 * ai-tutor-math-corpus.zip on 2026-09-25 — see data/CORPUS-INGEST.md.
 *
 * 1. INTEGRITY: every file matches the hash recorded at ingest
 *    (data/corpus.sha256). Nothing here "fixes" corpus content; a change
 *    to it has to be a deliberate re-ingest that updates the manifest.
 * 2. SCHEMA + PROVENANCE: every item has the documented shape, and every
 *    item can be traced to its source — a ministry-hosted URL plus a page
 *    (textbooks) or a document name (monthly worksheets).
 * 3. KNOWN ANOMALIES: extraction artifacts the corpus README does not
 *    mention are counted and pinned, not repaired. A changed count means
 *    the corpus changed.
 * 4. THE JOIN (lib/authoring/topic-join.ts) only names cells and slugs
 *    that exist.
 * 5. ISOLATION: no runtime code (app/, components/, lib/) imports the
 *    corpus — it is 19MB and would ride into every serverless bundle —
 *    and nothing child-facing reads english-international/ at all.
 *
 * Run: npx tsx tests/corpus.test.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TOPIC_JOIN } from "../lib/authoring/topic-join";
import { SLOT_TOPIC_IDS } from "../lib/authoring/rubric";

let passed = 0;
const failures: string[] = [];
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failures.push(name);
    console.error("  FAIL " + name + "\n        " + (e as Error).message);
  }
}

const ROOT = new URL("../", import.meta.url).pathname;
const CORPUS = join(ROOT, "data/corpus");
const read = (p: string) => readFileSync(join(CORPUS, p), "utf8");

interface Item {
  id: string;
  source: { series: string; publisher: string; url: string; volume?: string; page?: number; document?: string };
  grade: string;
  grade_num: number;
  topic: string;
  type: string;
  text: string;
  niqqud: boolean;
  phrasing_patterns: string[];
}
const all: Item[] = JSON.parse(read("items/all-items.json"));

// ---------------------------------------------------------------- integrity
console.log("integrity: the corpus is byte-for-byte what was ingested");
t("every file in data/corpus is in the manifest with the same sha256, and nothing extra is present", () => {
  const manifest = new Map(
    readFileSync(join(ROOT, "data/corpus.sha256"), "utf8")
      .trim()
      .split("\n")
      .map((l) => {
        const [hash, path] = l.split(/\s+/, 2);
        return [path.replace(/^\.\//, ""), hash] as const;
      })
  );
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(CORPUS, dir))) {
      const rel = dir ? `${dir}/${f}` : f;
      statSync(join(CORPUS, rel)).isDirectory() ? walk(rel) : files.push(rel);
    }
  };
  walk("");
  assert.deepEqual(files.sort(), [...manifest.keys()].sort());
  for (const f of files) {
    const got = createHash("sha256").update(readFileSync(join(CORPUS, f))).digest("hex");
    assert.equal(got, manifest.get(f), `${f} changed since ingest`);
  }
  assert.equal(files.length, 83);
});

// ---------------------------------------------------------------- schema
console.log("\nschema and provenance (12003 items)");
const GRADES: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5 };
const TOPICS = new Set(["numbers_place_value", "addition_subtraction", "multiplication", "division", "fractions", "geometry", "measurement", "patterns_sequences", "general"]);
const TYPES = new Set(["word_problem", "direct_question", "completion", "completion_question", "drill", "instruction_or_task"]);
const PATTERNS = new Set([
  "bare computation / instruction",
  "named-child story + כמה question",
  "imperative plural instruction (כתבו/השלימו/הקיפו/סמנו/פתרו)",
  "metacognition prompt (איך מצאתם/הסבירו/בדקו)",
  "compare (מי יותר/פחות)",
  "completion to round ten/hundred",
  "show your work (הציגו את דרך הפתרון)",
  "open task (multiple answers)",
]);
const ITEM_KEYS = ["grade", "grade_num", "id", "niqqud", "phrasing_patterns", "source", "text", "topic", "type"].join();

t("the README's counts: 12003 items, per grade א1628 ב2547 ג2107 ד3024 ה2697", () => {
  assert.equal(all.length, 12003);
  const per: Record<string, number> = {};
  for (const i of all) per[i.grade] = (per[i.grade] ?? 0) + 1;
  assert.deepEqual(per, { א: 1628, ב: 2547, ג: 2107, ד: 3024, ה: 2697 });
});
t("ids are unique", () => assert.equal(new Set(all.map((i) => i.id)).size, all.length));
t("every item has exactly the documented keys", () => {
  for (const i of all) assert.equal(Object.keys(i).sort().join(), ITEM_KEYS, i.id);
});
t("grade/grade_num agree; topic, type and pattern labels are from the documented sets", () => {
  for (const i of all) {
    assert.equal(GRADES[i.grade], i.grade_num, i.id);
    assert.ok(TOPICS.has(i.topic), `${i.id} topic ${i.topic}`);
    assert.ok(TYPES.has(i.type), `${i.id} type ${i.type}`);
    assert.ok(Array.isArray(i.phrasing_patterns) && i.phrasing_patterns.every((p) => PATTERNS.has(p)), i.id);
    assert.equal(typeof i.niqqud, "boolean", i.id);
    assert.ok(typeof i.text === "string" && i.text.trim().length > 0, i.id);
  }
});
t("provenance: a ministry-hosted https URL, a series and a publisher on every item", () => {
  for (const i of all) {
    assert.match(i.source.url, /^https:\/\/(meyda|pop)\.education\.gov\.il\//, i.id);
    assert.ok(i.source.series && i.source.publisher, i.id);
  }
});
t("provenance: textbook items carry volume + integer page; worksheet items carry a document", () => {
  let book = 0;
  let sheet = 0;
  for (const i of all) {
    if ("page" in i.source) {
      book++;
      assert.ok(Number.isInteger(i.source.page) && i.source.page! > 0, i.id);
      assert.ok(typeof i.source.volume === "string" && i.source.volume.length > 0, i.id);
      assert.equal(i.source.series, "פשוט חשבון", i.id);
    } else {
      sheet++;
      assert.match(i.source.document ?? "", /\.(docx|pdf)$/, i.id);
      assert.equal(i.source.url, "https://pop.education.gov.il/tchumey_daat/matmatika/yesodi/oraat-math/dapim-hodshiim/", i.id);
    }
  }
  assert.deepEqual([book, sheet], [11711, 292]);
});
t("the per-grade files are exactly all-items.json split by grade", () => {
  for (let n = 1; n <= 5; n++) {
    const g: Item[] = JSON.parse(read(`items/grade-${n}.json`));
    const want = all.filter((i) => i.grade_num === n);
    assert.equal(JSON.stringify(g), JSON.stringify(want), `grade-${n}.json`);
  }
});
t("topic-skill-map.json: grade → slug → {topic_he, skills[], ministry source_url}", () => {
  const map = JSON.parse(read("topic-skill-map.json"));
  assert.deepEqual(Object.keys(map).sort(), ["א", "ב", "ג", "ד"].sort());
  let cells = 0;
  let skills = 0;
  for (const g of Object.keys(map)) {
    for (const [slug, cell] of Object.entries<{ topic_he: string; skills: string[]; source_url: string }>(map[g])) {
      cells++;
      skills += cell.skills.length;
      assert.match(cell.topic_he, /[א-ת]/, `${g}/${slug}`);
      assert.ok(cell.skills.length > 0, `${g}/${slug}`);
      assert.match(cell.source_url, /^https:\/\/meyda\.education\.gov\.il\/.*\.pdf$/, `${g}/${slug}`);
    }
  }
  assert.deepEqual([cells, skills], [25, 507], "README: 25 cells, 507 skill statements");
});
t("a digest per grade", () => {
  for (let n = 1; n <= 5; n++) assert.match(read(`digests/phrasing-grade-${n}.md`), /^# Phrasing digest/);
});

// ---------------------------------------------------------------- anomalies
console.log("\nknown anomalies — counted and pinned, not repaired (see data/CORPUS-INGEST.md)");
const NIQQUD = /[ְ-ׇּׁׂ]/;
t("292 worksheet items have `document` in place of `page`/`volume` (README documents only volume/page)", () => {
  assert.equal(all.filter((i) => !("page" in i.source)).length, 292);
});
t("83 texts are not NFC (README: 'NFC-normalized')", () => {
  assert.equal(all.filter((i) => i.text.normalize("NFC") !== i.text).length, 83);
});
t("1 item has niqqud marks but niqqud:false", () => {
  assert.equal(all.filter((i) => !i.niqqud && NIQQUD.test(i.text)).length, 1);
  assert.equal(all.filter((i) => i.niqqud && !NIQQUD.test(i.text)).length, 0);
});
t("112 duplicate texts (extra copies)", () => {
  const seen = new Map<string, number>();
  for (const i of all) seen.set(i.text, (seen.get(i.text) ?? 0) + 1);
  assert.equal([...seen.values()].reduce((a, v) => a + (v > 1 ? v - 1 : 0), 0), 112);
});
t("82 texts contain a URL (teacher-note leaks), 142 contain Latin words", () => {
  assert.equal(all.filter((i) => i.text.includes("http")).length, 82);
  assert.equal(all.filter((i) => /[A-Za-z]{3,}/.test(i.text)).length, 142);
});
t("glyph-run artifacts: 2159 texts with a niqqud mark after a space, 443 with a detached maqaf (' ־')", () => {
  assert.equal(all.filter((i) => /\s[ְ-ׇ]/.test(i.text)).length, 2159);
  assert.equal(all.filter((i) => i.text.includes(" ־")).length, 443);
});
t("177 numbers ≥1,000 digit-reversed around the comma ('0001,' for 1,000; '000,9' for 9,000) — 56 of them in word_problem/direct_question, the types the README calls high fidelity", () => {
  const reversed = all.filter((i) => /(?<!\d)0\d{2,},|(?<!\d)0{2,3},\d/.test(i.text));
  assert.equal(reversed.length, 177);
  assert.equal(reversed.filter((i) => i.type === "word_problem" || i.type === "direct_question").length, 56);
});
t("6 degree signs extracted as a leading zero ('0360', '0180', '090')", () => {
  assert.equal(all.filter((i) => /(?<!\d)0(360|180|90)(?!\d)/.test(i.text)).length, 6);
});

// ---------------------------------------------------------------- the join
console.log("\nthe join table (lib/authoring/topic-join.ts)");
const map = JSON.parse(read("topic-skill-map.json"));
t("exactly one row per product math topic", () => {
  assert.deepEqual(TOPIC_JOIN.map((j) => j.productTopicId).sort(), [...SLOT_TOPIC_IDS].sort());
});
t("every ministry cell it names exists in topic-skill-map.json", () => {
  for (const j of TOPIC_JOIN) for (const c of j.ministry) assert.ok(map[c.grade]?.[c.slug], `${j.productTopicId} → ${c.grade}/${c.slug}`);
});
t("every corpus topic it names is a real item topic with items at that grade", () => {
  for (const j of TOPIC_JOIN) {
    for (const ct of j.corpusTopics) {
      assert.ok(TOPICS.has(ct), ct);
      assert.ok(all.some((i) => i.grade === j.grade && i.topic === ct), `${j.productTopicId}: no ${ct} items at ${j.grade}`);
    }
  }
});
t("'כפל וחילוק' (grade ג) joins BOTH multiplication and division", () => {
  const j = TOPIC_JOIN.find((x) => x.productTopicId === "math-g-multiplication-division")!;
  assert.deepEqual([...j.corpusTopics].sort(), ["division", "multiplication"]);
});
t("a row with no ministry cell or no corpus topic says GAP", () => {
  for (const j of TOPIC_JOIN) if (j.ministry.length === 0 || j.corpusTopics.length === 0) assert.match(j.why, /GAP/, j.productTopicId);
});
t("rows only join cells from their own grade", () => {
  for (const j of TOPIC_JOIN) for (const c of j.ministry) assert.equal(c.grade, j.grade, j.productTopicId);
});

// ---------------------------------------------------------------- isolation
console.log("\nisolation: the corpus never reaches the runtime bundle or a child");
t("no file under app/, components/ or lib/ imports or reads data/corpus", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(f)) {
        // Code only: comments are allowed to say where things come from.
        const code = readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        if (/data\/corpus/.test(code)) offenders.push(rel);
        if (/english-international/.test(code)) offenders.push(`${rel} (english-international)`);
      }
    }
  };
  for (const d of ["app", "components", "lib"]) walk(d);
  assert.deepEqual(offenders, []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("failed: " + failures.join(" | "));
  process.exit(1);
}
