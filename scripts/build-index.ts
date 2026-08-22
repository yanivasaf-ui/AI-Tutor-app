/**
 * Ingestion entry point: chunk -> embed -> store.
 * Run with: npm run build-index
 *
 * Today this runs against the placeholder seed in lib/rag/curriculum-seed.ts.
 * Real ingestion (pulling from ecat.education.gov.il / pop.education.gov.il)
 * replaces the import below with a scraper module producing the same
 * CurriculumChunk[] shape — the embed/store steps don't need to change.
 */
import { curriculumSeed } from "../lib/rag/curriculum-seed";
import { embedBatch } from "../lib/rag/embed";
import { saveIndex } from "../lib/rag/store";
import { EmbeddedChunk } from "../lib/rag/types";

async function main() {
  console.log(`Embedding ${curriculumSeed.length} curriculum chunks...`);
  const embeddings = await embedBatch(curriculumSeed.map((c) => `${c.topic}. ${c.text}`));

  const indexed: EmbeddedChunk[] = curriculumSeed.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i],
  }));

  saveIndex(indexed);
  console.log(`Wrote index for ${indexed.length} chunks to data/curriculum-index.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
