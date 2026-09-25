/**
 * What to call the objects a grouping exercise draws, for the tap-to-place
 * instruction ("לוחצים על תפוח, ואז על הקבוצה"). The instruction used to
 * say "כוכב" for everything; the production bank has 94 grouping rows and
 * none draw stars (apples, triangles, flowers, squares, clocks, rulers…),
 * and the generator may draw anything.
 *
 * The names are for the objects the bank actually holds plus the common
 * ones the prompt suggests; anything else — an emoji not listed, a Hebrew
 * letter, an unknown symbol — gets the neutral "חפץ" rather than a wrong
 * or invented name. Singular, since the instruction says "לוחצים על X".
 */

const NAMES: Readonly<Record<string, string>> = {
  "🍎": "תפוח", "🍏": "תפוח", "🍐": "אגס", "🍌": "בננה", "🍊": "תפוז", "🍓": "תות", "🍅": "עגבנייה", "🍪": "עוגייה", "🍬": "סוכרייה", "🍩": "סופגנייה",
  "🌸": "פרח", "🌼": "פרח", "🌷": "פרח", "🌹": "פרח", "🍃": "עלה", "🌙": "ירח",
  "⭐": "כוכב", "🌟": "כוכב",
  "🔺": "משולש", "🔻": "משולש", "📐": "משולש", "⛛": "משולש",
  "🟦": "ריבוע", "🟥": "ריבוע", "🟩": "ריבוע", "🟨": "ריבוע", "🟧": "ריבוע", "🟪": "ריבוע", "⬜": "ריבוע", "⬛": "ריבוע", "◻": "ריבוע", "◼": "ריבוע",
  "🔵": "עיגול", "🔴": "עיגול", "🟢": "עיגול", "🟡": "עיגול", "⚪": "עיגול", "⚫": "עיגול",
  "🧊": "קובייה", "🧱": "לבנה", "📦": "קופסה", "🎁": "מתנה",
  "⏰": "שעון", "🕐": "שעון", "🕑": "שעון", "🕒": "שעון", "⏱": "שעון עצר", "⏳": "שעון חול",
  "📏": "סרגל", "✏": "עיפרון", "📎": "מהדק", "📚": "ספר", "💵": "שטר", "🪙": "מטבע",
  "🎈": "בלון", "⚽": "כדור", "🏀": "כדור",
  "👦": "ילד", "🏃": "ילד", "👧": "ילדה", "👣": "טביעת רגל",
  "🐟": "דג", "🐶": "כלב", "🐱": "חתול",
};

/** Other words for the same object ("אטב" for a paper clip). */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  "📎": ["אטב"],
  "✏": ["עפרון"],
  "🍬": ["ממתק"],
  "📦": ["ארגז"],
  "⚽": ["כדורגל"],
};

/** Names too generic to say the drawn object is wrong: a coloured square
 *  or circle stands in for anything, and children or animals are usually
 *  the ones the objects are shared among. */
const GENERIC = new Set(["ריבוע", "עיגול", "משולש", "ילד", "ילדה", "דג", "כלב", "חתול"]);

const bareEmoji = (item: string) => item.replace(/[\uFE0E\uFE0F\u200D]/g, "");

function nounRegex(noun: string): RegExp {
  // singular, regular plural, and the -ה → -ות plural (סופגנייה/סופגניות)
  const stems = noun.endsWith("ה") ? [noun, noun.slice(0, -1)] : [noun];
  const forms = stems.flatMap((s) => [`${s}(?:ים|ות)?`, `${s}(?:ים|ות)?`]);
  return new RegExp(`(?<![\u05d0-\u05ea])[הובלמשכ]{0,2}(?:${[...new Set(forms)].join("|")})(?![\u05d0-\u05ea])`, "u");
}

/**
 * Objects the STORY names that are not the object DRAWN. Empty when the
 * story names the drawn object (by its name or an alias), when the drawn
 * object is generic (a colour square), or when the story names nothing we
 * know — it only speaks when it finds a different, specific object. QA
 * 2026-09-25: "אטבים 🧱" — clips, drawn as bricks.
 */
export function otherObjectsNamed(story: string, drawn: string): string[] {
  const own = NAMES[bareEmoji(drawn)];
  if (!own || GENERIC.has(own)) return [];
  const ownForms = [own, ...(ALIASES[bareEmoji(drawn)] ?? [])];
  if (ownForms.some((n) => nounRegex(n).test(story))) return [];
  const found = new Set<string>();
  for (const [emoji, noun] of Object.entries(NAMES)) {
    if (GENERIC.has(noun) || ownForms.includes(noun)) continue;
    for (const n of [noun, ...(ALIASES[emoji] ?? [])]) if (nounRegex(n).test(story)) found.add(noun);
  }
  return [...found];
}

/** The neutral name, for an object with no entry. */
export const NEUTRAL_OBJECT = "חפץ";

/** The Hebrew name of a grouping object, from its first drawn item. */
export function groupingObjectName(item: string | undefined): string {
  if (!item) return NEUTRAL_OBJECT;
  // Variation selectors and joiners turn "✏" into "✏️"; the name is the same.
  const bare = item.replace(/[︎️‍]/g, "");
  if (NAMES[bare]) return NAMES[bare];
  // A Hebrew letter as the object (a gematria row in the bank draws "א").
  if (/^[א-ת]$/.test(bare)) return "אות";
  return NEUTRAL_OBJECT;
}
