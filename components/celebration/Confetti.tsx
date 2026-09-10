import confetti from "canvas-confetti";

const BRAND_COLORS = ["#14b8a6", "#8b5cf6", "#ec4899"];

/**
 * Thin wrapper around canvas-confetti (UI Revamp Brief Section 5). Not a
 * rendered component — canvas-confetti manages its own full-screen canvas
 * internally, so there's nothing to mount. Exported as a function from
 * this file (not a class/hook) to keep the celebration system's pieces
 * where the file-by-file breakdown (brief Section 9) put them.
 *
 * Fires from `originEl`'s bounding-rect center when given (a bubble, a map
 * node) — falls back to screen center for full-screen tier-2/3 bursts.
 */
export function fireConfetti(originEl: HTMLElement | null | undefined, particleCount: number, big = false) {
  const origin = originEl
    ? (() => {
        const r = originEl.getBoundingClientRect();
        return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
      })()
    : { x: 0.5, y: 0.4 };

  confetti({
    particleCount,
    spread: big ? 90 : 55,
    startVelocity: big ? 45 : 30,
    origin,
    colors: BRAND_COLORS,
    scalar: big ? 1.1 : 0.9,
    ticks: big ? 220 : 150,
  });

  if (big) {
    // second burst from the opposite side for a fuller full-screen moment
    confetti({
      particleCount: Math.round(particleCount * 0.6),
      spread: 100,
      startVelocity: 40,
      origin: { x: 0.15, y: 0.6 },
      colors: BRAND_COLORS,
      ticks: 200,
    });
    confetti({
      particleCount: Math.round(particleCount * 0.6),
      spread: 100,
      startVelocity: 40,
      origin: { x: 0.85, y: 0.6 },
      colors: BRAND_COLORS,
      ticks: 200,
    });
  }
}
