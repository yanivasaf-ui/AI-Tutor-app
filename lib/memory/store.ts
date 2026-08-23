import fs from "fs";
import path from "path";
import {
  KidProfile,
  KidProfileStoreShape,
  Subject,
  SubjectProfile,
  emptySubjectProfile,
} from "./types";

/**
 * Simple JSON-file-backed kid profile store — same pattern already used for
 * the RAG index (lib/rag/store.ts): fine for MVP/prototype scale (a handful
 * of kids, single-digit subjects), no hosted DB / auth system required.
 *
 * Known limitation, stated honestly: on Vercel's serverless runtime the
 * filesystem is ephemeral per invocation/instance, so writes here are NOT
 * guaranteed to survive across deploys or across cold-started instances in
 * production the way they do in local dev. Fine for prototype/local
 * testing; swap for a real DB (Vercel KV/Postgres/etc.) before this needs
 * to reliably persist real users' data in production.
 */
const DB_PATH = path.join(process.cwd(), "data", "kid-profiles.json");

function load(): KidProfileStoreShape {
  if (!fs.existsSync(DB_PATH)) {
    return { kids: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { kids: {} };
  }
}

function save(data: KidProfileStoreShape) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function listKids(): KidProfile[] {
  return Object.values(load().kids);
}

export function getKid(id: string): KidProfile | null {
  return load().kids[id] ?? null;
}

export function createKid(name: string, avatarId: string | null): KidProfile {
  const data = load();
  const id = `kid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const kid: KidProfile = {
    id,
    name,
    avatarId,
    createdAt: new Date().toISOString(),
    subjects: {},
  };
  data.kids[id] = kid;
  save(data);
  return kid;
}

export function setKidAvatar(id: string, avatarId: string): KidProfile | null {
  const data = load();
  const kid = data.kids[id];
  if (!kid) return null;
  kid.avatarId = avatarId;
  save(data);
  return kid;
}

export function getSubjectProfile(kidId: string, subject: Subject): SubjectProfile | null {
  const kid = getKid(kidId);
  return kid?.subjects[subject] ?? null;
}

/** Merge-updates a subject profile. `patch` fields, when provided, replace
 *  the corresponding field (arrays are replaced wholesale by the caller,
 *  which is expected to have already merged/deduped/truncated them). */
export function updateSubjectProfile(
  kidId: string,
  subject: Subject,
  patch: Partial<SubjectProfile>
): SubjectProfile | null {
  const data = load();
  const kid = data.kids[kidId];
  if (!kid) return null;
  const current = kid.subjects[subject] ?? emptySubjectProfile();
  const next: SubjectProfile = {
    ...current,
    ...patch,
    sessionCount: current.sessionCount + 1,
    lastUpdated: new Date().toISOString(),
  };
  kid.subjects[subject] = next;
  save(data);
  return next;
}
