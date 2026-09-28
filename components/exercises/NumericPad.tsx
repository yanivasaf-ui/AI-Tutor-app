"use client";

/**
 * Kids-App UX Benchmark, build-first item 5: an in-app 3×4 numeric pad for
 * numeric open answers (fill_in_blank — see ExerciseScreen.tsx's call
 * site for exactly which exercises qualify and why).
 *
 * This is a pure input surface: every button here manipulates the SAME
 * `answer` state the existing free-text <input> already uses, through the
 * three callbacks below, and the confirm key calls the SAME submitAnswer
 * the existing "שלח" button and the input's own Enter key call. It never
 * holds its own copy of the answer and never calls anything else — no new
 * submission path, no way for it to drift out of sync with typing, pasting,
 * or the mic.
 *
 * fill_in_blank's own generation prompt (lib/exercises/generate.ts)
 * guarantees a non-negative whole number ("התוצאה חייבת להיות מספר שלם
 * ולא שלילי"), so digits 0-9 plus backspace plus confirm is the complete
 * set — no minus key, no decimal point.
 *
 * No new Hebrew copy: digit labels are bare numerals (not any language's
 * words), and ⌫/✓ carry English aria-labels (Backspace/Confirm) rather
 * than a new Hebrew phrase, per the benchmark's zero-new-Hebrew-strings
 * rule pending Udi's review.
 */
interface Props {
  value: string;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onConfirm: () => void;
  disabled: boolean;
}

const DIGIT_ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

export default function NumericPad({ value, onDigit, onBackspace, onConfirm, disabled }: Props) {
  const keyClass =
    "min-h-16 rounded-[var(--radius-button)] border-2 border-[var(--color-teal)]/30 bg-[var(--color-surface)] text-2xl font-medium text-[var(--color-ink)] hover:bg-[var(--color-teal-soft)] disabled:opacity-50 disabled:hover:bg-[var(--color-surface)]";

  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {DIGIT_ROWS.flat().map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onDigit(d)}
          disabled={disabled}
          aria-label={d}
          className={keyClass}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        onClick={onBackspace}
        // Backspacing an already-empty answer is a no-op the kid can still
        // safely tap (no error, no shake) — only submitting truly needs
        // the empty guard, so this key is never disabled by emptiness,
        // only while a submission is in flight.
        disabled={disabled}
        aria-label="Backspace"
        className={keyClass}
      >
        ⌫
      </button>
      <button
        type="button"
        onClick={() => onDigit("0")}
        disabled={disabled}
        aria-label="0"
        className={keyClass}
      >
        0
      </button>
      <button
        type="button"
        onClick={onConfirm}
        // Never submit empty or twice: same guard as the existing "שלח"
        // button (disabled={submitting || !answer.trim()}).
        disabled={disabled || !value.trim()}
        aria-label="Confirm"
        className={`${keyClass} bg-[var(--color-teal)] text-white border-[var(--color-teal)] hover:bg-[var(--color-teal)] disabled:hover:bg-[var(--color-teal)]`}
      >
        ✓
      </button>
    </div>
  );
}
