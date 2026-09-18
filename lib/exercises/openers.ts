/**
 * The deterministic openers, in a module with NO imports.
 *
 * feat: verdict-first evaluation. These are needed on both sides — the
 * server picks one from the locked verdict, and the client prefetches all
 * three so the chosen one is already in the TTS cache when the verdict
 * lands. They live here rather than in lib/exercises/evaluate.ts because
 * that module imports the Anthropic client: importing it from a client
 * component pulled the whole SDK into the browser bundle (measured: the
 * page went from 150kB to 200kB).
 *
 * The opener exists to end the silence at verdict-lock instead of at
 * prose-lock. It is exempt from lineIsArithmeticallySafe for one
 * structural reason only: it is written here, in code, and contains no
 * arithmetic and no answer. That exemption does not extend to anything a
 * model generates — the prose that follows is still gated whole.
 *
 * Each opener is the leading clause of the deterministic line it opens
 * (see evaluate.ts's REST_* constants), so opener + rest reads as the one
 * sentence it always was. Fixed strings on purpose: a fixed line can be
 * prefetched, which is what makes the opener audible at ~0ms of TTS.
 */
export const OPENERS = {
  correct: "כל הכבוד!",
  hint: "זה בסדר, זה קורה!",
  explain: "זה בסדר, זו שאלה לא פשוטה!",
} as const;

export type OpenerKind = keyof typeof OPENERS;

/** Which opener a locked verdict calls for. A pure function of the
 *  verdict, so the opener can never contradict what the code decided. */
export function openerKindFor(opts: {
  correct: boolean;
  secondAttempt: boolean;
  verifiedAnswer: number | null;
}): OpenerKind {
  if (opts.correct) return "correct";
  if (opts.secondAttempt && opts.verifiedAnswer !== null) return "explain";
  return "hint";
}
