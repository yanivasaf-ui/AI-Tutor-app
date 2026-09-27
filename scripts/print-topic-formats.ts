/**
 * Prints the per-topic allowed-format table (lib/map/topic-formats.ts) as a
 * readable document, docs/topic-formats.md, for owner review without reading
 * code. tests/topic-formats.test.mts fails if the committed document and the
 * data disagree.
 *
 * Run: npx tsx scripts/print-topic-formats.ts [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { TOPICS, OPERATION_NAMES_HE } from "../lib/map/topics";
import { TOPIC_FORMATS } from "../lib/map/topic-formats";
import type { ExerciseSubtype } from "../lib/exercises/types";

export const FORMAT_LABELS: Readonly<Record<ExerciseSubtype, string>> = {
  fill_in_blank: "computation (a sum to work out)",
  pick_operation: "pick the operation",
  explain_thinking: "explain your thinking",
  number_line_placement: "number line / ruler",
  pattern_completion: "number sequence (continue it)",
  visual_grouping: "grouping into equal groups (division)",
  equation_balance: "equation with a blank",
  shape_match: "shape pattern",
  comprehension: "reading comprehension",
  spelling_correction_mc: "spelling choice",
  root_pattern_mc: "root / pattern choice",
  word_build: "build a word from letters",
  sentence_order: "order the words into a sentence",
  vowel_select_mc: "choose the niqqud",
  phonemic_visual_mc: "sound / letter matching",
};

const CONDITION_LABELS: Readonly<Record<string, string>> = {
  "number-line-needs-operation": "number line only when the exercise involves an operation (placing a stated number alone is not allowed)",
};

export function renderTopicFormats(): string {
  const out: string[] = [
    "# Allowed exercise formats per topic",
    "",
    "Generated from `lib/map/topic-formats.ts` by `npx tsx scripts/print-topic-formats.ts`. Do not edit by hand: a test fails if this file and the data disagree.",
    "",
    "Every exercise generated, banked or served under a topic must use one of its formats and only its operations. A topic marked **UNSERVED** is hidden from the map and never generated or served.",
    "",
  ];
  for (const subject of ["math", "hebrew"] as const) {
    for (const grade of ["א", "ב", "ג"] as const) {
      out.push(`## ${subject === "math" ? "Math" : "Hebrew"}, grade ${grade}`, "");
      for (const t of TOPICS.filter((x) => x.subject === subject && x.grade === grade)) {
        const r = TOPIC_FORMATS[t.id];
        out.push(`### ${t.displayNameKid} — \`${t.id}\``);
        out.push(`*${t.topic}*`, "");
        if (r.unserved) {
          out.push(`- **UNSERVED** — ${r.unserved}`);
        } else {
          out.push(`- **Formats:** ${r.formats.map((f) => FORMAT_LABELS[f]).join("; ")}`);
          if (subject === "math") {
            out.push(`- **Operations:** ${r.operations.length ? r.operations.map((o) => OPERATION_NAMES_HE[o]).join(", ") : "none (no arithmetic)"}`);
          }
          for (const c of r.conditions ?? []) out.push(`- **Condition:** ${CONDITION_LABELS[c]}`);
        }
        out.push(`- **Basis:** ${r.basis}`, "");
      }
    }
  }
  return out.join("\n");
}

const OUT = join(new URL("../", import.meta.url).pathname, "docs/topic-formats.md");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const md = renderTopicFormats();
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "utf8") !== md) {
      console.error("docs/topic-formats.md is stale — run npx tsx scripts/print-topic-formats.ts");
      process.exit(1);
    }
    console.log("docs/topic-formats.md is up to date");
  } else {
    writeFileSync(OUT, md);
    console.log(`wrote ${OUT}`);
  }
}
