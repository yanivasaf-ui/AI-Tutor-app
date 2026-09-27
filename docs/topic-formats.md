# Allowed exercise formats per topic

Generated from `lib/map/topic-formats.ts` by `npx tsx scripts/print-topic-formats.ts`. Do not edit by hand: a test fails if this file and the data disagree.

Every exercise generated, banked or served under a topic must use one of its formats and only its operations. A topic marked **UNSERVED** is hidden from the map and never generated or served.

## Math, grade א

### מספרים עד 100 — `math-a-numbers-0-100`
*הכרת המספרים הטבעיים בתחום ה-0 עד ה-100*

- **Formats:** number sequence (continue it); number line / ruler
- **Operations:** none (no arithmetic)
- **Basis:** 'ספירה בדילוגים של 2, 5 ו-10', 'הכרת ישר המספרים ועבודה עם סדרות (חוקיות)'; owner: skip-counting allowed under numbers topics

### לחבר ולחסר — `math-a-addition-subtraction`
*פעולות חשבון בתחום ה-100 (חיבור וחיסור)*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking; number line / ruler
- **Operations:** חיבור, חיסור
- **Condition:** number line only when the exercise involves an operation (placing a stated number alone is not allowed)
- **Basis:** 'הצגת מצבים של חיבור… וחיסור… בשפה מתמטית', 'חיבור וחיסור בתחום ה-20… ה-100'; owner G5: number line only with an operation

### צורות — `math-a-geometry`
*צורות גאומטריות*

- **Formats:** shape pattern; computation (a sum to work out)
- **Operations:** חיבור
- **Basis:** 'מיון מצולעים… לפי צלעות', 'פירוק והרכבה של מצולעים'; owner: shape patterns + counting sides/vertices only; owner G3: computation with addition is the counting container (e.g. 'משולש וריבוע, כמה צלעות? 3+4')

### למדוד אורך — `math-a-length`
*מדידות אורך*

- **Formats:** number line / ruler
- **Operations:** none (no arithmetic)
- **Basis:** 'השוואה ישירה של אורכי עצמים', 'יחידת מידה סטנדרטית (סנטימטר)'; owner G2: measurement only (ruler / number line), no adding or subtracting lengths in grade א

### השעון — `math-a-time`
*מדידת זמן*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking
- **Operations:** חיבור, חיסור
- **Basis:** 'קריאת שעון… חישובי משך זמן', 'חיבור וחיסור בתחום ה-20 מיושם על שאלות מילוליות הקשורות למדידת זמן'

### לספור ולסדר — `math-a-data`
*חקר נתונים*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank
- **Operations:** חיבור, חיסור
- **Basis:** 'קריאת נתונים מוצגים בדיאגרמת עמודות'; owner G2: computation / pick-operation / equation with the data given in words in the question (the app draws no charts)

## Math, grade ב

### מספרים עד 1,000 — `math-b-numbers-0-1000`
*הכרת המספרים הטבעיים בתחום ה-0 עד ה-1,000*

- **Formats:** number sequence (continue it); number line / ruler
- **Operations:** none (no arithmetic)
- **Basis:** 'ספירה בדילוגים של 2, 5, 10, 20, 50 ו-100', 'המבנה העשרוני'; owner: skip-counting allowed; owner G1: no grouping/division under numbers

### לחבר, לחסר, לכפול ולחלק — `math-b-arithmetic`
*פעולות חשבון בתחום ה-100: חיבור, חיסור, ותחילת כפל וחילוק*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking; grouping into equal groups (division); number line / ruler
- **Operations:** חיבור, חיסור, כפל, חילוק
- **Condition:** number line only when the exercise involves an operation (placing a stated number alone is not allowed)
- **Basis:** 'חיבור וחיסור במאונך', 'תחילת הכפל: הכפל כחיבור חוזר', 'תחילת החילוק… חילוק לחלקים וחילוק לחלוקות'; owner G4: no sequences here; owner G5: number line only with an operation

### צורות — `math-b-geometry`
*צורות גאומטריות*

- **Formats:** shape pattern; computation (a sum to work out)
- **Operations:** חיבור
- **Basis:** 'מיון משולשים לפי סוגי צלעות… ולפי זוויות', 'פירוק והרכבה של מצולעים'; owner: shape patterns + counting sides/vertices only; owner G3: addition as the counting container

### למדוד אורך — `math-b-length`
*מדידות אורך*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; number line / ruler; explain your thinking
- **Operations:** חיבור, חיסור
- **Basis:** 'מדידת אורך וסרטוט קווים ישרים לפי אורך נתון', 'חישוב אורך של קו שבור על ידי סיכום אורכי הקטעים'; owner: length = add/subtract lengths only, no sequences

### גופים: קוביות וכדורים — `math-b-volume`
*גופים ומדידות נפח*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking
- **Operations:** חיבור, כפל
- **Basis:** 'חישוב מספר הקוביות המרכיבות תיבה באמצעות כפל מספר הקוביות בשכבה במספר השכבות'; owner: layers × cubes allowed (e.g. 6×4), no division. add: counting cubes layer by layer, and the other choice a pick-operation needs

### השעון — `math-b-time`
*מדידת זמן*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking
- **Operations:** חיבור, חיסור
- **Basis:** 'קריאת שעון בשעות, חצאי שעות ודקות', 'חישובי משך זמן… (לוח זמנים, שעת התחלה וסיום של פעילות)'

### לספור ולסדר — `math-b-data`
*חקר נתונים*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank
- **Operations:** חיבור, חיסור
- **Basis:** 'קריאה ובניית דיאגרמות עמודות… המאפשרות השוואה ("יותר", "פחות", "הכי הרבה")'; owner G2: data given in words in the question

## Math, grade ג

### מספרים גדולים — `math-g-numbers-0-10000`
*הכרת המספרים הטבעיים בתחום ה-0 עד ה-10,000 (הרבבה)*

- **Formats:** number sequence (continue it); number line / ruler
- **Operations:** none (no arithmetic)
- **Basis:** 'ספירה ומנייה בדילוגים שונים', 'זיהוי חוקיות ברצף המספרים'; owner: skip-counting allowed under numbers topics

### גימטרייה — `math-g-gematria`
*גימטרייה*

- **Formats:** explain your thinking
- **Operations:** none (no arithmetic)
- **Basis:** 'הכרת ערכי האותיות… והשוואה בין השיטה העשרונית… לבין שיטת הגימטרייה'; owner G2: explain format only, no summing of letter values in grade ג

### לחבר ולחסר מספרים גדולים — `math-g-arithmetic`
*פעולות חשבון בתחום הרבבה: חיבור, חיסור, אומדן*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking; number line / ruler
- **Operations:** חיבור, חיסור
- **Condition:** number line only when the exercise involves an operation (placing a stated number alone is not allowed)
- **Basis:** 'חיבור וחיסור במאונך… בתחום הרבבה', 'אומדן', 'משוואות ואי-שוויונות (34+___=36+___)'; owner G5: number line only with an operation

### כפל וחילוק — `math-g-multiplication-division`
*כפל וחילוק בתחום הרבבה*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking; grouping into equal groups (division); number line / ruler
- **Operations:** חיבור, חיסור, כפל, חילוק
- **Condition:** number line only when the exercise involves an operation (placing a stated number alone is not allowed)
- **Basis:** 'כפל וחילוק ב-10, 100 ו-1,000', 'חילוק עם שארית… חילוק לחלקים לחילוק לחלוקות', 'חוק הפילוג… סדר פעולות החשבון' (hence + and −); owner G4: skip-counting sequences only under numbers topics; owner G5: number line only with an operation

### זוויות ומשולשים — `math-g-geometry`
*צורות גאומטריות: זוויות ומשולשים*

- **Formats:** shape pattern; computation (a sum to work out)
- **Operations:** חיבור
- **Basis:** 'הכרת סוגי זוויות', 'סיווג משולשים לפי סוגי צלעות וזוויות'; owner: shape patterns + counting sides/vertices; owner G3: addition as the counting container (a classifying format is follow-on work)

### למדוד שטח — `math-g-area`
*מדידת שטח*

- **Formats:** computation (a sum to work out)
- **Operations:** חיבור
- **Basis:** 'מדידת שטח ביחידות מידה שרירותיות ולבסוף… סנטימטר-רבוע'; owner G2: computation with addition only (counting units), no multiplication

### גופים: קוביות וכדורים — `math-g-volume`
*גופים ומדידות נפח*

- **UNSERVED** — the grade-ג text is nets only ('פריסה של תיבה') and no nets format exists (owner G2)
- **Basis:** 'המשך העיסוק בתיבות וקוביות, כולל פריסה של תיבה'

### השעון — `math-g-time`
*מדידת זמן*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank; explain your thinking
- **Operations:** חיבור, חיסור
- **Basis:** 'קריאת שעות ודקות בשעון אנלוגי ודיגיטלי, כולל חישובי משך זמן'

### לספור ולסדר — `math-g-data`
*חקר נתונים*

- **Formats:** computation (a sum to work out); pick the operation; equation with a blank
- **Operations:** חיבור, חיסור, כפל
- **Basis:** 'דיאגרמות עמודות ופיקטוגרמות, כולל… קנה-מידה (כל סמל מייצג יותר מיחידה אחת)' (hence ×); owner G2: data given in words in the question

## Hebrew, grade א

### אותיות וצלילים — `hebrew-a-alphabet-phonology`
*הכרת יסודות הקריאה והכתיבה: מודעות פונולוגית וידע שמות האותיות*

- **Formats:** sound / letter matching; build a word from letters
- **Basis:** 'מודעות פונולוגית — היכולת לזהות ולתפעל יחידות צליליות', 'שמות האותיות ומקשרים ביניהם לצלילים', 'יסודות הקריאה והכתיבה'

### להתחיל לקרוא — `hebrew-a-early-reading`
*קידום הבנת הנקרא בתחילת הדרך*

- **Formats:** reading comprehension
- **Basis:** 'ההבנה מתפתחת… הקשבה לסיפור, ולסוגי טקסט שונים', 'הבנת הנקרא'

### להתחיל לכתוב — `hebrew-a-early-writing`
*תחילת תהליכי הכתיבה: כתיב פונטי*

- **Formats:** build a word from letters; choose the niqqud
- **Basis:** 'כתיב פונטי ("מה שאני שומע אני כותב")', 'מודעות פונולוגית לתנועות עצמן'

### מילים חדשות — `hebrew-a-oral-vocabulary`
*קידום השיח הדבור והרחבת אוצר מילים*

- **Formats:** reading comprehension
- **Basis:** 'הרחבה… של אוצר המילים… בהקשרים משמעותיים'; owner G2: only the parts the text names — the oral-discourse part has no format

## Hebrew, grade ב

### לכתוב נכון — `hebrew-b-standard-orthography`
*התקדמות לקראת כתיב תקני*

- **Formats:** spelling choice
- **Basis:** 'להקנות במפורש חוקי כתיב', 'זוגות אותיות הומופוניות'; owner G6: dedicated spelling format only — comprehension as a container is banned

### משחקים במילים — `hebrew-b-metalinguistic`
*קידום ידע מטה-לשוני*

- **Formats:** root / pattern choice
- **Basis:** 'זיהוי מוספיות… זיהוי תבניות שורש ומשקל'; owner G6: dedicated root/pattern format only — comprehension as a container is banned

### לקרוא סיפור קצר — `hebrew-b-reading-fluency-literature`
*שטף קריאה, קריאה להנאה, והוראת יצירות ספרות*

- **Formats:** reading comprehension
- **Basis:** 'שטף הקריאה', 'יצירות ספרות מגוונות', 'קריאה עצמאית לשם הנאה'; owner: Hebrew reading = comprehension formats only (no root/spelling drills)

## Hebrew, grade ג

### להבין מה שקוראים — `hebrew-g-reading-comprehension`
*השלמת תהליך רכישת הקריאה והבנת טקסטים עיוניים*

- **Formats:** reading comprehension
- **Basis:** 'הפקת משמעות מטקסטים עיוניים', 'הבחנה בין רעיון מרכזי לפרטים תומכים'

### לקרוא סיפורים — `hebrew-g-literary-texts-reading-pleasure`
*התנסות עם טקסטים ספרותיים וטיפוח קריאה להנאה*

- **Formats:** reading comprehension
- **Basis:** 'לזהות מרכיבי סיפור — דמויות, עלילה, מקום'

### מילים חכמות — `hebrew-g-vocabulary`
*הרחבת אוצר מילים*

- **Formats:** reading comprehension
- **Basis:** 'להסיק את משמען [של מילים] מן ההקשר'

### לכתוב חיבור קצר — `hebrew-g-writing-process`
*קידום תהליכי כתיבה*

- **Formats:** spelling choice; order the words into a sentence
- **Basis:** 'ליישם כללי כתיב ופיסוק', 'תשומת לב… למבנה משפט'; owner G2: only the parts the text names — the planning/drafting process has no format

### לדבר ולהסביר — `hebrew-g-oral-expression`
*הבעה בעל פה*

- **UNSERVED** — oral presentation, argument and discussion — no exercise format fits (owner G2)
- **Basis:** 'ארגון והצגת דברור קצר', 'הבעת דעה תוך מתן נימוקים', 'השתתפות בדיון כיתתי'

### לגלות איך מילים עובדות — `hebrew-g-metalinguistic`
*פיתוח ידע מטה-לשוני*

- **Formats:** root / pattern choice; spelling choice
- **Basis:** 'זיהוי שורש משותף', 'זיהוי מוספיות נפוצות', '…לכתיב נכון בכתיבה'; owner G6: dedicated formats only — comprehension as a container is banned
