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
