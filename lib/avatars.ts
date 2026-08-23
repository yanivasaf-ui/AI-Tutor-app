export interface AvatarOption {
  id: string;
  label: string;
  category: "superhero" | "anime" | "fantasy" | "animal";
  emoji: string;
  colorFrom: string;
  colorTo: string;
}

/**
 * Placeholder character pack per the locked decision
 * (M-memory/decisions.md, "AI Tutor IL: Character Avatar Locked for MVP",
 * 2026-08-22): spans superhero / anime / fantasy / animal styles, all
 * clearly stylized/cartoon, never photorealistic or human-like. Emoji +
 * CSS gradient placeholders only — final production art is an explicit
 * human decision deferred to Asaf, not built here.
 */
export const AVATAR_OPTIONS: AvatarOption[] = [
  {
    id: "hero-comet",
    label: "קומטה",
    category: "superhero",
    emoji: "🦸",
    colorFrom: "#60a5fa",
    colorTo: "#2563eb",
  },
  {
    id: "hero-spark",
    label: "ניצוץ",
    category: "superhero",
    emoji: "🦹",
    colorFrom: "#f472b6",
    colorTo: "#db2777",
  },
  {
    id: "anime-kuro",
    label: "קורו",
    category: "anime",
    emoji: "🐉",
    colorFrom: "#a78bfa",
    colorTo: "#7c3aed",
  },
  {
    id: "anime-mika",
    label: "מיקה",
    category: "anime",
    emoji: "🌸",
    colorFrom: "#fb7185",
    colorTo: "#e11d48",
  },
  {
    id: "fantasy-pip",
    label: "פיפ הקוסם",
    category: "fantasy",
    emoji: "🧙",
    colorFrom: "#34d399",
    colorTo: "#059669",
  },
  {
    id: "fantasy-luna",
    label: "לונה החד-קרן",
    category: "fantasy",
    emoji: "🦄",
    colorFrom: "#c4b5fd",
    colorTo: "#8b5cf6",
  },
  {
    id: "animal-tuki",
    label: "טוקי הינשוף",
    category: "animal",
    emoji: "🦉",
    colorFrom: "#fbbf24",
    colorTo: "#d97706",
  },
  {
    id: "animal-mango",
    label: "מנגו השועל",
    category: "animal",
    emoji: "🦊",
    colorFrom: "#fb923c",
    colorTo: "#ea580c",
  },
];

export const AVATAR_CATEGORY_LABELS: Record<AvatarOption["category"], string> = {
  superhero: "גיבורי על",
  anime: "אנימה",
  fantasy: "פנטזיה",
  animal: "חיות",
};

export function getAvatarById(id: string | null | undefined): AvatarOption | null {
  if (!id) return null;
  return AVATAR_OPTIONS.find((a) => a.id === id) ?? null;
}
