import { notFound } from "next/navigation";
import { homeworkModeEnabled } from "@/lib/homework/flag";
import HomeworkHelp from "@/components/homework/HomeworkHelp";

/** Read the flag per request, never at build time: a prototype must be
 *  switchable off without a redeploy. */
export const dynamic = "force-dynamic";

/**
 * /homework — the flag-gated homework-help prototype.
 *
 * A server component so the flag stays on the server: with HOMEWORK_MODE
 * unset this route 404s exactly like a page that was never written, which
 * is the intended default. Nothing here touches an account, and nothing is
 * stored — the session lives in React state and ends with the tab.
 */
export default function HomeworkPage() {
  if (!homeworkModeEnabled()) notFound();
  return <HomeworkHelp />;
}
