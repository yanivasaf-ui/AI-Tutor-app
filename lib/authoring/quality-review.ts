import { getAnthropicClient, TUTOR_MODEL } from "@/lib/llm/anthropic";
import type { Exercise } from "@/lib/exercises/types";
import { UNIVERSAL_RULES, type RuleId } from "./rubric";
import type { QualityResult, QualityViolation } from "./quality-gate";

/**
 * The judgment half of the authoring rubric: a model reads a draft against
 * the rules code cannot check (spoken age-appropriate Hebrew, a concrete
 * scenario, story/number consistency beyond what quality-gate.ts parses).
 *
 * OFF BY DEFAULT. Running it inline adds one model call to every freshly
 * generated question — latency the child waits through on a bank miss,
 * and cost on every draft. Whether that trade is worth it is a product
 * decision, so it is a switch, not a default:
 *
 *   QUESTION_REVIEW=inline  → generate.ts reviews every draft before it
 *                             can be saved or served (rejected drafts are
 *                             retried like any other gate failure).
 *   QUESTION_REVIEW unset / "off" → no review call anywhere at runtime.
 *
 * FAIL-OPEN. A review that errors or returns something unparseable passes
 * the draft (with a warning): the deterministic gate has already run, and
 * a flaky reviewer must not turn into "משהו השתבש" for a child.
 */

export type ReviewMode = "off" | "inline";

export function reviewMode(): ReviewMode {
  return process.env.QUESTION_REVIEW === "inline" ? "inline" : "off";
}

const RULE_IDS = new Set<string>(UNIVERSAL_RULES.map((r) => r.id));

export function reviewPrompt(ex: Exercise, context?: string): string {
  const rules = UNIVERSAL_RULES.map((r) => `- [${r.id}] ${r.he}`).join("\n");
  const shown = {
    question: ex.question,
    passage: ex.passage,
    choices: ex.choices,
    grouping: ex.grouping ? { objects: ex.grouping.items.length, emoji: ex.grouping.items[0], groups: ex.grouping.groupCount } : undefined,
    tiles: ex.tiles?.items,
    correctAnswer: ex.correctAnswer,
  };
  return `את/ה בודק/ת שאלה במתמטיקה לילד/ה בכיתה ${ex.grade} לפני שהיא מוצגת. בדוק/י אותה מול הכללים:
${rules}
${context ? `\nכך נשמעות שאלות בנושא הזה בספרי משרד החינוך (לעיון, לא להעתקה):\n${context}\n` : ""}
השאלה (JSON):
${JSON.stringify(shown, null, 1)}

החזר/י אך ורק JSON: {"pass": true} אם השאלה עומדת בכל הכללים, אחרת {"pass": false, "violations": [{"rule": "<מזהה הכלל>", "detail": "<מה לא תקין, במשפט אחד>"}]}`;
}

export async function reviewQuestion(ex: Exercise, context?: string): Promise<QualityResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: TUTOR_MODEL,
      max_tokens: 300,
      system: "את/ה מחזיר/ה אך ורק JSON תקין, ללא טקסט נוסף, ללא markdown code fences.",
      messages: [{ role: "user", content: reviewPrompt(ex, context) }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text content");
    const parsed = JSON.parse(block.text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim());
    if (parsed.pass === true) return { ok: true, checked: true, violations: [] };
    const violations: QualityViolation[] = (Array.isArray(parsed.violations) ? parsed.violations : [])
      .filter((v: { rule?: unknown }) => typeof v?.rule === "string" && RULE_IDS.has(v.rule))
      .map((v: { rule: string; detail?: unknown }) => ({ rule: v.rule as RuleId, detail: String(v.detail ?? "") }));
    // "pass: false" naming no rule we know is not a verdict we can act on.
    if (violations.length === 0) return { ok: true, checked: true, violations: [] };
    return { ok: false, checked: true, violations };
  } catch (err) {
    console.warn(`[question-review] review failed, passing the draft: ${err instanceof Error ? err.message : err}`);
    return { ok: true, checked: false, violations: [] };
  }
}
