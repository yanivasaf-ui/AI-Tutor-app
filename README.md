# AI Tutor IL

Hebrew-language, curriculum-aligned AI tutor for elementary school kids (grades א'-ג' to start — Math + Hebrew language), sold direct-to-parent.

Full project context: `the-system-v8/P-projects/ai-tutor-il/` in the main workspace repo (brief, decisions, CONTEXT.md). This app is the build artifact; that repo is the knowledge base.

## Stack

- Next.js (App Router) + TypeScript + Tailwind v4 — same pattern as `dna-kit-app`
- `@anthropic-ai/sdk` — tutor conversation generation (Claude)
- `@huggingface/transformers` — local, on-device multilingual embeddings (no API key, no per-query cost). Model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. Swappable for OpenAI/Voyage later by editing only `lib/rag/embed.ts` if quality needs to improve — nothing else in the pipeline needs to change.
- In-repo JSON vector index (`data/curriculum-index.json`), cosine similarity search — no external vector DB yet. Fine at this scale (single digits of subjects/grades); swap `lib/rag/store.ts` for a real vector store (Cloudflare Vectorize, pgvector) if/when content volume grows past what a brute-force scan handles comfortably.

## RAG pipeline

```
lib/rag/curriculum-seed.ts   -- REAL Ministry-sourced content (grades א'-ג', math + Hebrew)
        |
scripts/build-index.ts        -- chunk -> embed -> save (npm run build-index)
        |
data/curriculum-index.json    -- the "vector store"
        |
lib/rag/store.ts              -- cosine similarity search at request time
        |
app/api/chat/route.ts         -- retrieve + build system prompt + call Claude
```

`curriculum-seed.ts` now holds real content sourced from `ecat.education.gov.il` / `pop.education.gov.il`, not placeholder text. See `the-system-v8/P-projects/ai-tutor-il/brain/curriculum-research-math-hebrew-a-g.md` in the workspace repo for the sourcing notes.

## Tutor behavior

`lib/prompts/tutor-system-prompt.ts` encodes the decisions locked in `M-memory/decisions.md` ("AI Tutor IL: Build-Direction Decisions", 2026-08-22):
- Hint-first tutoring (MathDial/Bridge pattern) — never hands over the answer immediately
- Process praise, not person praise (Dweck/Mindset Kit)
- Validate feelings before correcting (CASEL, math-anxiety research)
- Off-curriculum or emotional messages: gentle redirect, never dismiss, never improvise on unsafe territory — flagged via `looksOffCurriculumOrEmotional()` for a future parent-dashboard log (currently just `console.log`, no dashboard built yet)

## Persistent per-kid memory (added 2026-08-23)

Per the locked placement/calibration decision — no quiz, no parent onboarding, level derived entirely from real exercise performance, adjusted session-by-session, with the tutor LLM (not a hardcoded rule) judging pacing:

- `lib/memory/types.ts` — `SubjectProfile` shape: `estimatedLevel`, `topicsCovered`, `errorPatterns`, `emotionalSignals`, `recentSummary`, all free-text/LLM-written, not scored fields
- `lib/memory/store.ts` — JSON-file-backed store (`data/kid-profiles.json`), same simple pattern as the RAG index. **Known limitation, stated plainly: on Vercel's serverless runtime this filesystem is ephemeral across deploys/cold starts — writes are not guaranteed to persist in production.** Fine for local dev/prototype testing; swap for a real DB (Vercel KV/Postgres) before this needs to reliably hold real users' data.
- `lib/memory/update.ts` — after each tutor reply, a second lightweight Claude call reads the current profile + the latest exchange and returns an updated profile as JSON. Failures here never break the reply the kid actually sees (falls back to leaving the profile untouched).
- `app/api/kids/` — create/fetch kid profiles, set avatar
- Wired into `app/api/chat/route.ts` (optional `kidId` in the request) and `buildTutorSystemPrompt()` in `tutor-system-prompt.ts`

## Character avatar picker (added 2026-08-23)

Per the locked decision (superhero/anime/fantasy/animal styles, never photorealistic/human-like):

- `lib/avatars.ts` — the character pack. **Emoji + CSS gradient placeholders only** — final production art is an explicit human/Asaf decision, not made here.
- `components/AvatarPicker.tsx` — picker grid UI + `AvatarBadge` shown in the chat header and next to tutor replies
- Picked once at the `KidSetup` screen in `app/page.tsx` (name + avatar), persisted via `/api/kids`, stored client-side in `localStorage` to skip setup on return visits

## Open items before this is real

- **Model choice not locked.** Currently hardcoded to Claude (`lib/llm/anthropic.ts`). A Hebrew tone/cost/latency comparison against GPT-4o-class and Gemini is still owed — needs `OPENAI_API_KEY` / a Gemini text-API key added to `.env.local` (not committed, not pasted into chat — add directly to the file).
- **Licensing**: fine for this prototype; needs a real answer from Ministry/MATACH before any paid/public launch (per the locked decision).
- **Parent dashboard**: the off-curriculum/emotional flag currently just logs to the server console — no actual dashboard or notification exists yet.
- **Kid-profile persistence is local-filesystem-backed, not production-durable on Vercel** — see the memory-layer caveat above. Needs a real DB before trusting this with real families' data.
- **Character art is placeholder** (emoji/gradients) — real art sourcing/style is an explicit deferred human decision, not started.
- **Voice/talking-avatar layer is explicitly deferred, not built** — spec'd in the workspace brief's resource list, deliberately out of MVP scope (latency, cost, unverified Hebrew child-voice quality).
- **Multi-kid account switching, parent dashboard, and full visual/UI design** — still open per the brief.

## Local dev

```bash
npm install
npm run build-index   # only needed once, or after curriculum-seed.ts changes
npm run dev            # runs on :3001 (dna-kit-app already uses :3000)
```

Requires `ANTHROPIC_API_KEY` in `.env.local` (already set locally, copied from `dna-kit-app`).
