import fs from "fs";
import path from "path";
import { EmbeddedChunk, RetrievedChunk } from "./types";

const INDEX_PATH = path.join(process.cwd(), "data", "curriculum-index.json");

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized (mean-pooled, normalize: true)
}

let cache: EmbeddedChunk[] | null = null;

function loadIndex(): EmbeddedChunk[] {
  if (cache) return cache;
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(
      `Curriculum index not found at ${INDEX_PATH}. Run "npm run build-index" first.`
    );
  }
  cache = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  return cache!;
}

export function saveIndex(chunks: EmbeddedChunk[]) {
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(chunks, null, 2));
}

export function search(
  queryEmbedding: number[],
  opts: { topK?: number; subject?: string; grade?: string } = {}
): RetrievedChunk[] {
  const { topK = 4, subject, grade } = opts;
  const index = loadIndex();

  return index
    .filter((c) => (subject ? c.subject === subject : true))
    .filter((c) => (grade ? c.grade === grade : true))
    .map((c) => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ embedding: _embedding, ...rest }) => rest);
}
