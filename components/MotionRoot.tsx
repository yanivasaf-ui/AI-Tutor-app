"use client";

import { MotionConfig } from "framer-motion";

/**
 * One app-wide switch for prefers-reduced-motion across every
 * framer-motion animation (bubble springs, screen slides, tap scales,
 * celebration entrances): with reducedMotion="user", transforms are
 * skipped for users who ask for less motion while opacity fades still
 * run. Renders no DOM of its own.
 */
export default function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
