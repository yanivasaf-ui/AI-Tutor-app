/**
 * Real Ministry of Education curriculum content — Math (grades א'-ג') and
 * Hebrew language education (grades א'-ד', see note below).
 *
 * Sourced from official Ministry PDFs, extracted 2026-08-22 (Math, Hebrew
 * א'-ב') and 2026-09-10 (Hebrew ג'). Full research trail for the
 * 2026-08-22 pass, including the original note that a distinct grade-ג'
 * Hebrew document hadn't yet been found, is in:
 * the-system-v8/P-projects/ai-tutor-il/brain/curriculum-research-math-hebrew-a-g.md
 *
 * Grade-ג' Hebrew gap closed 2026-09-10: found "תוכנית הוראה להטמעת יעדי
 * החינוך הלשוני בכיתות ג'-ד'" (Ministry of Education, 2010) — a genuine
 * distinct document, just not surfaced by the earlier search pass. It
 * treats ג'-ד' as one continuous 2-year program (10 shared objectives,
 * end-of-ד' as the target, end-of-ב' as the assumed foundation) rather
 * than giving fully separate per-grade goal lists the way the math
 * documents do — the hebrew-g-* entries below describe grade-ג''s
 * starting point within that shared progression, not an isolated ג'-only
 * curriculum, and say so explicitly where the source itself frames it
 * that way.
 *
 * This replaces the earlier placeholder seed — do not add invented content
 * here; if a topic isn't sourced, it doesn't belong in this file.
 */
import { CurriculumChunk } from "./types";

const MATH_A_SOURCE =
  "https://meyda.education.gov.il/files/Mazkirut_Pedagogit/math/primary-school/math2023/Newprogramgrade1.pdf";
const MATH_B_SOURCE =
  "https://meyda.education.gov.il/files/Mazkirut_Pedagogit/math/primary-school/math2023/Newprogramgrade2.pdf";
const MATH_G_SOURCE =
  "https://meyda.education.gov.il/files/Mazkirut_Pedagogit/math/primary-school/math2023/Newprogramgrade3.pdf";
const HEBREW_AB_SOURCE = "https://meyda.education.gov.il/files/olim/hatmatyeadeyhebrew.pdf";
const HEBREW_GD_SOURCE = "https://meyda.education.gov.il/files/Hemed/hl/209.pdf";

export const curriculumSeed: CurriculumChunk[] = [
  // ===== Math — Grade א' =====
  {
    id: "math-a-numbers-0-100",
    subject: "math",
    grade: "א",
    topic: "הכרת המספרים הטבעיים בתחום ה-0 עד ה-100",
    text: "ספירה קדימה ואחורה עד 100, כולל ספירה בדילוגים של 2, 5 ו-10, וספירה אחורה מ-50 בדילוגים של 2. מנייה עד 100 והתאמת כמות למספר. קריאה וכתיבה של המספרים הטבעיים בתחום ה-100 וה-0, במילים ובספרות. הכרת ישר המספרים ועבודה עם סדרות (חוקיות פשוטות ומורכבות).",
    source: MATH_A_SOURCE,
  },
  {
    id: "math-a-addition-subtraction",
    subject: "math",
    grade: "א",
    topic: "פעולות חשבון בתחום ה-100 (חיבור וחיסור)",
    text: "הצגת מצבים של חיבור (איסוף, הוספה) וחיסור (הפרדה, גריעה) מחיי היום-יום בשפה מתמטית. חיבור וחיסור בתחום ה-20, ולאחר מכן חיבור וחיסור בתחום שלמות העשרות בתחום ה-100 (למשל 20+60=80, לפי 2+6=8). חוק החילוף וחוק הקיבוץ בחיבור נלמדים באופן אינטואיטיבי, ללא צורך בשמות פורמליים.",
    source: MATH_A_SOURCE,
  },
  {
    id: "math-a-geometry",
    subject: "math",
    grade: "א",
    topic: "צורות גאומטריות",
    text: "מיון מצולעים (משולש, מרובע, ריבוע ומעוין) לפי קריטריונים שונים ולפי צלעות. פירוק והרכבה של מצולעים ממצולעים אחרים. מיקום וכיוונים בסביבה, קריאת מפות פשוטות של הכיתה או בית הספר.",
    source: MATH_A_SOURCE,
  },
  {
    id: "math-a-length",
    subject: "math",
    grade: "א",
    topic: "מדידות אורך",
    text: "תיאור והשוואה של מדידות אורך (גבוה/נמוך, עבה/דק, קצר/ארוך). השוואה ישירה של אורכי עצמים ובאמצעות אמצעי מדידה שרירותיים (מרוחקי יד, צעדים, אטבים). מעבר הדרגתי ליחידות מידה שרירותיות ולבסוף ליחידת מידה סטנדרטית (סנטימטר).",
    source: MATH_A_SOURCE,
  },
  {
    id: "math-a-time",
    subject: "math",
    grade: "א",
    topic: "מדידת זמן",
    text: "קריאת שעון אנלוגי בשעות עגולות ובחצאי שעות. חישובי משך זמן בשעות שלמות ובחצאי שעות. חיבור וחיסור בתחום ה-20 מיושם על שאלות מילוליות הקשורות למדידת זמן.",
    source: MATH_A_SOURCE,
  },
  {
    id: "math-a-data",
    subject: "math",
    grade: "א",
    topic: "חקר נתונים",
    text: "קריאת נתונים מוצגים בדיאגרמת עמודות, איסוף נתונים ובניית דיאגרמת עמודות פשוטה מתוך נושאים מחיי הכיתה (למשל חודשי לידה של תלמידי הכיתה).",
    source: MATH_A_SOURCE,
  },

  // ===== Math — Grade ב' =====
  {
    id: "math-b-numbers-0-1000",
    subject: "math",
    grade: "ב",
    topic: "הכרת המספרים הטבעיים בתחום ה-0 עד ה-1,000",
    text: "הרחבת ספירה ומנייה עד 1,000 תוך ביסוס המבנה העשרוני (יחידות, עשרות, מאות). קריאה וכתיבה של מספרים בתחום ה-1,000 במילים ובספרות. ספירה בדילוגים של 2, 5, 10, 20, 50 ו-100. הכרת מספרים זוגיים ואי-זוגיים והקשר בינם לבין ספירה בדילוגים של 2.",
    source: MATH_B_SOURCE,
  },
  {
    id: "math-b-arithmetic",
    subject: "math",
    grade: "ב",
    topic: "פעולות חשבון בתחום ה-100: חיבור, חיסור, ותחילת כפל וחילוק",
    text: "חיבור וחיסור במאונך של מספרים דו-ספרתיים ושל עשרות שלמות. תכונות חיבור וחיסור, חוק החילוף וחוק הקיבוץ בחיבור. תחילת הכפל: הכפל כחיבור חוזר (למשל 3×4 כ-4+4+4), לוח הכפל עד 10, זיהוי מצבים כפליים בחיי היום-יום. תחילת החילוק: פעולת החילוק נלמדת בשתי משמעויות — חילוק לחלקים וחילוק לחלוקות (לכמה קבוצה שוות מתחלק כל הכמות).",
    source: MATH_B_SOURCE,
  },
  {
    id: "math-b-geometry",
    subject: "math",
    grade: "ב",
    topic: "צורות גאומטריות",
    text: "מיון משולשים לפי סוגי צלעות (שווה-צלעות, שווה-שוקיים, שונה-צלעות) ולפי זוויות. הכרת זווית ישרה וזיהויה במצולעים ובעצמים מחיי היום-יום. פירוק והרכבה של מצולעים.",
    source: MATH_B_SOURCE,
  },
  {
    id: "math-b-length",
    subject: "math",
    grade: "ב",
    topic: "מדידות אורך",
    text: "מדידת אורך וסרטוט קווים ישרים לפי אורך נתון, בסנטימטרים ובמטרים שלמים. חישוב אורך של קו שבור על ידי סיכום אורכי הקטעים המרכיבים אותו.",
    source: MATH_B_SOURCE,
  },
  {
    id: "math-b-volume",
    subject: "math",
    grade: "ב",
    topic: "גופים ומדידות נפח",
    text: "הכרת גופים תלת-ממדיים (קובייה, תיבה) ובניית מבנים פשוטים מקוביות לפי דוגמה או תמונה. חישוב מספר הקוביות המרכיבות תיבה באמצעות כפל מספר הקוביות בשכבה במספר השכבות.",
    source: MATH_B_SOURCE,
  },
  {
    id: "math-b-time",
    subject: "math",
    grade: "ב",
    topic: "מדידת זמן",
    text: "קריאת שעון בשעות, חצאי שעות ודקות מדויקות. חישובי משך זמן בשעות ובחצאי שעות בהקשרים מחיי היום-יום (לוח זמנים, שעת התחלה וסיום של פעילות).",
    source: MATH_B_SOURCE,
  },
  {
    id: "math-b-data",
    subject: "math",
    grade: "ב",
    topic: "חקר נתונים",
    text: "קריאה ובניית דיאגרמות עמודות מתוך נתונים שנאספו, כולל עמודות המייצגות כמויות שונות ומאפשרות השוואה ('יותר', 'פחות', 'הכי הרבה').",
    source: MATH_B_SOURCE,
  },

  // ===== Math — Grade ג' =====
  {
    id: "math-g-numbers-0-10000",
    subject: "math",
    grade: "ג",
    topic: "הכרת המספרים הטבעיים בתחום ה-0 עד ה-10,000 (הרבבה)",
    text: "המבנה העשרוני של המספרים עד 10,000: יחידות, עשרות, מאות ואלפים. קריאה וכתיבה של מספרים במילים ובספרות בתחום הרבבה. ספירה ומנייה בדילוגים שונים (10, 25, 50, 100, 200, 500, 1,000). זיהוי חוקיות ברצף המספרים והשוואה ביניהם באמצעות הסימנים <, > ,=.",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-gematria",
    subject: "math",
    grade: "ג",
    topic: "גימטרייה",
    text: "הכרת ערכי האותיות א'-ת' בשיטה הגימטרית, והשוואה בין השיטה העשרונית (המבוססת על מיקום הספרה) לבין שיטת הגימטרייה (המבוססת על ערך קבוע לכל אות).",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-arithmetic",
    subject: "math",
    grade: "ג",
    topic: "פעולות חשבון בתחום הרבבה: חיבור, חיסור, אומדן",
    text: "חיבור וחיסור במאונך של מספרים בתחום הרבבה. שימוש באומדן לפני פתרון תרגיל כדי לבדוק סבירות של תוצאה. עיסוק במשוואות ואי-שוויונות (למשל השלמת מספרים מתאימים במשוואה כמו 34+___=36+___).",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-multiplication-division",
    subject: "math",
    grade: "ג",
    topic: "כפל וחילוק בתחום הרבבה",
    text: "כפל וחילוק ב-10, 100 ו-1,000 (הגדלה/הקטנה פי 10 וכלליה). ביסוס לוח הכפל 10×10. סימני ההתחלקות ב-2, 5 ו-10. חילוק עם שארית וללא שארית — הבחנה בין חילוק לחלקים לחילוק לחלוקות גם במצבי שארית. הגורמים למכפלה, חוק הפילוג (דיסטריביוטיביות) וסדר פעולות החשבון.",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-geometry",
    subject: "math",
    grade: "ג",
    topic: "צורות גאומטריות: זוויות ומשולשים",
    text: "הכרת סוגי זוויות: זווית חדה, ישרה, קהה וחדה, ללא הגדרה פורמלית של מידת הזווית (מעלות) — זיהוי חזותי והשוואה לזווית ישרה. סיווג משולשים לפי סוגי צלעות וזוויות.",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-area",
    subject: "math",
    grade: "ג",
    topic: "מדידת שטח",
    text: "השוואת שטחים של צורות שונות (כולל צורות דו-ממדיות לא-סטנדרטיות) באמצעות פירוק והרכבה. מדידת שטח ביחידות מידה שרירותיות ולבסוף ביחידות מידה סטנדרטיות — סנטימטר-רבוע (סמ\"ר). חישוב שטח מלבן וריבוע באמצעות ספירת ריבועי שטח ברשת (grid).",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-volume",
    subject: "math",
    grade: "ג",
    topic: "גופים ומדידות נפח",
    text: "המשך העיסוק בתיבות וקוביות, כולל פריסה של תיבה (זיהוי איזו פריסה יכולה להתקפל לתיבה נתונה).",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-time",
    subject: "math",
    grade: "ג",
    topic: "מדידת זמן",
    text: "קריאת שעות ודקות בשעון אנלוגי ודיגיטלי, כולל חישובי משך זמן מדויקים יותר מבכיתה ב'.",
    source: MATH_G_SOURCE,
  },
  {
    id: "math-g-data",
    subject: "math",
    grade: "ג",
    topic: "חקר נתונים",
    text: "קריאה ובניית דיאגרמות עמודות ופיקטוגרמות, כולל דיאגרמות עם קנה-מידה (כל סמל מייצג יותר מיחידה אחת).",
    source: MATH_G_SOURCE,
  },

  // ===== Hebrew — Grade א' (foundations) =====
  {
    id: "hebrew-a-alphabet-phonology",
    subject: "hebrew",
    grade: "א",
    topic: "הכרת יסודות הקריאה והכתיבה: מודעות פונולוגית וידע שמות האותיות",
    text: "רכישת הקריאה והכתיבה מבוססת על שני היבטים: ידיעת מערכת הכתב (איך הכתב מייצג את מערכת הדיבור) וידיעת השיח (איך משתמשים בכתוב לתקשורת). מודעות פונולוגית — היכולת לזהות ולתפעל יחידות צליליות של המילה הדבורה (הברות, חריזה, פונמות) — היא תנאי הכרחי אך לא מספיק לרכישת קריאה. ילדים לומדים תחילה שמות האותיות ומקשרים ביניהם לצלילים, כאשר רוב הילדים מגיעים לכיתה א' עם ידע חלקי כבר מגן הילדים. חשוב ללמד את יסודות הקריאה והכתיבה מתוך פעילויות בעלות משמעות, ולא מתוך תרגול אותיות מבודד.",
    source: HEBREW_AB_SOURCE,
  },
  {
    id: "hebrew-a-early-reading",
    subject: "hebrew",
    grade: "א",
    topic: "קידום הבנת הנקרא בתחילת הדרך",
    text: "בתחילת כיתה א', לפני שהתלמידים שולטים בפענוח עצמאי, ההבנה מתפתחת בעיקר באמצעות הבנה נשמעת (הקראה של המורה) — הקשבה לסיפור, ולסוגי טקסט שונים (סיפורתי ומידעי), פיתוח קשב לשוני ואוצר מילים. עם התקדמות מיומנויות הפענוח, נבנה הקשר בין הבנה נשמעת להבנת הנקרא העצמאית.",
    source: HEBREW_AB_SOURCE,
  },
  {
    id: "hebrew-a-early-writing",
    subject: "hebrew",
    grade: "א",
    topic: "תחילת תהליכי הכתיבה: כתיב פונטי",
    text: "בראשית כיתה א' הכתיבה של רוב התלמידים מתבססת בעיקר על מערכת הכתיב הפונטי ('מה שאני שומע אני כותב'), עם התייחסות חלקית לעיצורים בלבד ולעיתים בלי לציין את התנועות. במהלך השנה מתפתחת בהדרגה גם מודעות פונולוגית לתנועות עצמן, ומתחיל תהליך המעבר לכתיב מדויק יותר.",
    source: HEBREW_AB_SOURCE,
  },
  {
    id: "hebrew-a-oral-vocabulary",
    subject: "hebrew",
    grade: "א",
    topic: "קידום השיח הדבור והרחבת אוצר מילים",
    text: "פעילויות שיח מובנות סביב טקסטים וחוויות מחיי היום-יום, לצד הרחבה ישירה ועקיפה של אוצר המילים דרך חשיפה חוזרת למילים חדשות בהקשרים משמעותיים (לא רשימות מילים מבודדות).",
    source: HEBREW_AB_SOURCE,
  },

  // ===== Hebrew — Grade ב' (toward standard orthography) =====
  {
    id: "hebrew-b-standard-orthography",
    subject: "hebrew",
    grade: "ב",
    topic: "התקדמות לקראת כתיב תקני",
    text: "עד סוף כיתה ב', רוב התלמידים אמורים לעבור ממערכת כתיב פונטי למערכת כתיב תקני-אורתוגרפי בסיסי, אך עדיין אינם שולטים במלואה. יש להקנות במפורש חוקי כתיב על-פי כללי האורתוגרפיה, ולתת דגש מיוחד על זוגות אותיות הומופוניות (נשמעות אותו דבר אך נכתבות שונה): ב/ו, כ/ק, ת/ט, ס/ש, א/ע, ח/כ. ההחלפות ההומופוניות מוכלות באות השורש (למשל 'כותבת' במקום 'קותבת') ובאותיות תנועות ('הפרעתי' במקום 'הפרעתי') — טיפול בהחלפות אלה נדרש בהתייחס לשורש המילה, לא רק לצליל.",
    source: HEBREW_AB_SOURCE,
  },
  {
    id: "hebrew-b-metalinguistic",
    subject: "hebrew",
    grade: "ב",
    topic: "קידום ידע מטה-לשוני",
    text: "פיתוח מודעות מורפולוגית: זיהוי מוספיות (יחיד/רבים, נטיות גוף), זיהוי מוספיות היוצרות שמות תואר, זיהוי תבניות שורש ומשקל — ידע זה תומך הן בהבנת הנקרא והן בכתיבה תקנית.",
    source: HEBREW_AB_SOURCE,
  },
  {
    id: "hebrew-b-reading-fluency-literature",
    subject: "hebrew",
    grade: "ב",
    topic: "שטף קריאה, קריאה להנאה, והוראת יצירות ספרות",
    text: "המשך פיתוח שטף הקריאה (קריאה מהירה ומדויקת ללא מאמץ פענוח מודע), לצד חשיפה ליצירות ספרות מגוונות וטיפוח הרגלי קריאה עצמאית לשם הנאה — לא רק לצורך למידה פורמלית.",
    source: HEBREW_AB_SOURCE,
  },

  // ===== Hebrew — Grade ג' (first year of the combined ג'-ד' program) =====
  // Source document treats ג'-ד' as one continuous 2-year push toward a
  // shared set of end-of-ד' goals, building on end-of-ב' as the assumed
  // foundation — not a fully separate ג'-only curriculum. See the file
  // header note above.
  {
    id: "hebrew-g-reading-comprehension",
    subject: "hebrew",
    grade: "ג",
    topic: "השלמת תהליך רכישת הקריאה והבנת טקסטים עיוניים",
    text: "בהמשך לביסוס הפענוח שנרכש בכיתות א'-ב', כיתה ג' ממשיכה לגבש שטף קריאה עצמאית ומתחילה להתמקד בהפקת משמעות מטקסטים עיוניים לא-מוכרים במגוון אורכים וצפיפויות. הדגש הוא על זיהוי מבנה הטקסט ומטרתו, הבחנה בין רעיון מרכזי לפרטים תומכים, יצירת קשר בין טקסטים שונים על אותו נושא, ושימוש מודע באסטרטגיות קריאה לפני הקריאה, במהלכה ואחריה. זוהי שנה ראשונה מתוך תהליך דו-שנתי (ג'-ד') — שליטה מלאה ביעדים אלה נדרשת רק עד סוף כיתה ד'.",
    source: HEBREW_GD_SOURCE,
  },
  {
    id: "hebrew-g-literary-texts-reading-pleasure",
    subject: "hebrew",
    grade: "ג",
    topic: "התנסות עם טקסטים ספרותיים וטיפוח קריאה להנאה",
    text: "התלמידים נחשפים ליצירות ספרות מגוונות (ישראלית, יהודית ואוניברסלית) ולומדים לזהות מרכיבי סיפור — דמויות, עלילה, מקום — ולקשר אותם לעולמם. במקביל, מודגש טיפוח קריאה להנאה כערך עצמאי ולא רק ככלי ללמידה פורמלית: זמינות מאגר ספרים מגוון בבית הספר ועידוד התלמידים ליזום קריאה עצמאית מעבר לנדרש בשיעור.",
    source: HEBREW_GD_SOURCE,
  },
  {
    id: "hebrew-g-vocabulary",
    subject: "hebrew",
    grade: "ג",
    topic: "הרחבת אוצר מילים",
    text: "המשך הרחבת אוצר המילים באמצעות חשיפה ישירה ועקיפה למילים חדשות בהקשר משמעותי, מתוך הטקסטים והנושאים הנלמדים בפועל — לא רשימות מילים מבודדות. התלמידים לומדים לשים לב למילים לא-מוכרות תוך כדי קריאה, להסיק את משמען מן ההקשר, ולפתח הרגל אישי של בירור ותיעוד מילים חדשות (מעין מילון אישי מתפתח).",
    source: HEBREW_GD_SOURCE,
  },
  {
    id: "hebrew-g-writing-process",
    subject: "hebrew",
    grade: "ג",
    topic: "קידום תהליכי כתיבה",
    text: "הכתיבה בכיתה ג' נלמדת כתהליך רב-שלבי — תכנון, טיוטה, שיפור ועריכה, ולבסוף פרסום — ולא כתוצר חד-פעמי. התלמידים לומדים לארגן תוכן לפני הכתיבה, לקרוא מחדש ולשפר טיוטות משלהם, וליישם כללי כתיב ופיסוק ביתר מודעות. בהמשך למעבר מכתיב פונטי לכתיב תקני שהיה יעד סוף כיתה ב', כיתה ג' ממשיכה לבסס כללי כתיב תקניים ומוסיפה תשומת לב מודעת יותר למבנה משפט וארגון פסקה.",
    source: HEBREW_GD_SOURCE,
  },
  {
    id: "hebrew-g-oral-expression",
    subject: "hebrew",
    grade: "ג",
    topic: "הבעה בעל פה",
    text: "יעדי הבעה בעל-פה מובנים: ארגון והצגת דברור קצר בנושא נתון עם פתיחה, גוף וסיום ברורים, הבעת דעה תוך מתן נימוקים לה, והשתתפות בדיון כיתתי מובנה — הקשבה לאחרים, שמירה על הנושא, ובנייה על דברי הדוברים הקודמים.",
    source: HEBREW_GD_SOURCE,
  },
  {
    id: "hebrew-g-metalinguistic",
    subject: "hebrew",
    grade: "ג",
    topic: "פיתוח ידע מטה-לשוני",
    text: "בהמשך למודעות המורפולוגית שהוקנתה בכיתה ב' (שורש ומשקל, יחיד/רבים, נטיות גוף), כיתה ג' מעמיקה את הידע המפורש על מבנה המילה בעברית — זיהוי שורש משותף במילים קרובות משמעות, זיהוי מוספיות נפוצות, ושימוש בידע זה הן לפענוח מילים לא-מוכרות בקריאה והן לכתיב נכון בכתיבה.",
    source: HEBREW_GD_SOURCE,
  },
];
