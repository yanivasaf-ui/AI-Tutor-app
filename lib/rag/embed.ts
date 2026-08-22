import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Local, multilingual sentence embedding model — runs on-device, no API key,
 * no per-query cost. Covers Hebrew (among 50+ languages). Good enough for MVP
 * retrieval quality; swap for OpenAI text-embedding-3 or Voyage AI later by
 * changing only this file if a paid provider key is added and quality needs
 * to improve — the rest of the RAG pipeline (chunk/store/retrieve) is
 * provider-agnostic and does not need to change.
 *
 * Uses onnxruntime-node (native binary) under the hood. For that binary to
 * survive on Vercel, next.config.ts must list this package under
 * serverExternalPackages so Next.js leaves it un-bundled — see the comment
 * there for why.
 */
const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", MODEL_ID) as Promise<FeatureExtractionPipeline>;
  }
  return embedderPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}
