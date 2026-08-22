export interface CurriculumChunk {
  id: string;
  subject: "math" | "hebrew";
  grade: "א" | "ב" | "ג";
  topic: string;
  text: string;
  source: string;
}

export interface EmbeddedChunk extends CurriculumChunk {
  embedding: number[];
}

export interface RetrievedChunk extends CurriculumChunk {
  score: number;
}
