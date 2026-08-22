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
lib/rag/curriculum-seed.ts   -- PLACEHOLDER content, NOT from the Ministry yet
        |
scripts/build-index.ts        -- chunk -> embed -> save (npm run build-index)
        |
data/curriculum-index.json    -- the "vector store"
        |
lib/rag/store.ts              -- cosine similarity search at request time
        |
app/api/chat/route.ts         -- retrieve + build system prompt + call Claude
```

**`curriculum-seed.ts` is illustrative only** — a handful of hand-written topic summaries to prove the pipeline works, explicitly labeled as placeholder in the file. Real ingestion from `ecat.education.gov.il` (textbook catalog) and `pop.education.gov.il` (curriculum standards) — both confirmed reachable, no geo-block from this environment — is separate, larger work: someone has to go through the Ministry's actual approved topic sequence and terminology grade by grade. Do not treat the seed content as sourced or licensed.

## Tutor behavior

`lib/prompts/tutor-system-prompt.ts` encodes the decisions locked in `M-memory/decisions.md` ("AI Tutor IL: Build-Direction Decisions", 2026-08-22):
- Hint-first tutoring (MathDial/Bridge pattern) — never hands over the answer immediately
- Process praise, not person praise (Dweck/Mindset Kit)
- Validate feelings before correcting (CASEL, math-anxiety research)
- Off-curriculum or emotional messages: gentle redirect, never dismiss, never improvise on unsafe territory — flagged via `looksOffCurriculumOrEmotional()` for a future parent-dashboard log (currently just `console.log`, no dashboard built yet)

## Open items before this is real

- **Model choice not locked.** Currently hardcoded to Claude (`lib/llm/anthropic.ts`). A Hebrew tone/cost/latency comparison against GPT-4o-class and Gemini is still owed — needs `OPENAI_API_KEY` / a Gemini text-API key added to `.env.local` (not committed, not pasted into chat — add directly to the file).
- **Real curriculum ingestion** replacing the placeholder seed.
- **Licensing**: fine for this prototype; needs a real answer from Ministry/MATACH before any paid/public launch (per the locked decision).
- **Parent dashboard**: the off-curriculum/emotional flag currently just logs to the server console — no actual dashboard or notification exists yet.
- **No GitHub repo / deployment yet** — this only runs locally so far.

## Local dev

```bash
npm install
npm run build-index   # only needed once, or after curriculum-seed.ts changes
npm run dev            # runs on :3001 (dna-kit-app already uses :3000)
```

Requires `ANTHROPIC_API_KEY` in `.env.local` (already set locally, copied from `dna-kit-app`).
