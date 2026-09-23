# Field test — 5–8 children, ages 6–8

Written 2026-09-23. Run this **before** the next round of experience work,
not after. The instrumentation it depends on is
`lib/fieldtest/sessionLog.ts`; the export is described at the end.

## Who, and the one rule for the room

- **5–8 children, ages 6–8**, spread across grades א–ג so the read-aloud
  split (א–ב automatic, ג tap-to-hear) is exercised on both sides.
- Include at least two who **do not** like maths. A tutor that only works
  for willing children has not been tested.
- **A parent is present but does not guide.** This is the rule the whole
  study turns on, and the one most likely to break: the parent sits where
  the child can see them and may comfort, but does not read the question
  aloud, does not explain the hint, and does not answer for the child.
- Brief the parent in those words, out loud, before starting. Then tell
  them the most useful thing they can do is **say when they would have
  stepped in** — because that moment is measure 3.

## The three scenarios

Each child does all three, in this order. The order matters: a child who
hits an ASR failure first will not trust voice for the rest of the session.

### Scenario A — the child answers correctly

Give a problem comfortably inside their level.

**Watch for:**
- Do they answer by voice or by tap, unprompted? (First choice, not eventual.)
- After the verdict, do they wait for the character to finish, or move on?
- Does the strategy-naming praise land — do they look up, say anything back?
- If "איך ידעת?" fires: do they answer it, ignore it, or look to the parent?
- Does the session-goal line at the start mean anything to them? Ask afterwards:
  *"what were we doing today?"*

### Scenario B — the child answers wrong

Let a genuine wrong answer happen. **Do not engineer one** — wait for it;
in a 15-minute session with a mixed-ability child one will come. If none
does by minute 10, move them up a level and let the difficulty do it.

**Watch for:**
- Their face at the verdict opener ("כמעט!"). The word lands before any
  content does.
- Do they retry, ask for a hint, or stall? How long is the stall?
- If they take a hint: which rung do they stop at, and do they act on it
  **without the parent explaining it**? (Measure 2.)
- Does the "small win" at the end of the ladder read as a win, or as
  another question?
- Does the parent's body language change before the child's does?

### Scenario C — ASR failure

Induce it honestly: ask the child to answer **while the parent talks
over them**, or have them mumble deliberately, or answer from across the
room. Do not fake it in software — the point is the real recogniser
failing the way it fails at home.

**Watch for:**
- At the confirmation ("התכוונת ל-12?"), do they answer yes/no by voice,
  by button, or freeze?
- How many repairs before they tap? (Measure 1.)
- Do they blame themselves? Listen for *"I said it wrong"* versus
  *"it didn't hear me"*. The first is the failure mode that matters.
- Does the parent reach for the device? When? (Measure 3.)

## The four measures the log must answer

| # | Measure | Where it comes from |
|---|---|---|
| 1 | **Repairs before tap** | `summary.repairsBeforeTap` — repairs on problems the child ended up tapping. A problem tapped with no repairs is not counted: the question is what it costs before a child gives up on voice. |
| 2 | **Hint comprehension without the parent** | `summary.hintRungsPerProblem` gives the rung count; **whether it landed is an observation**, noted against the problem number. The log cannot see comprehension — it can only say how far down the ladder they went before answering. |
| 3 | **Parent "it's broken" moments** | **Not in the log.** A researcher's timestamped note, lined up against the raw `events` array. This is why the export carries raw events and not only the summary. |
| 4 | **Ending feel** | `summary.ending` (`completed` / `left` / `still-open`, and on which problem) plus the closing question below. |

Two of the four are observations, not telemetry. Said plainly so nobody
plans the study expecting the log to answer them.

## Closing question, asked of every child

After the session, away from the screen, ask exactly this and write down
the first sentence verbatim:

> **"איך היה?"**

Then one follow-up only: **"תרצה לעשות את זה שוב מחר?"** Record yes / no /
hesitation. Hesitation is a finding.

Ask the parent separately: **"מתי היית נכנס לעזור?"**

## What is recorded, and what is not

- The log holds **what kind of thing happened and when** — never the
  child's answers, never a transcript. An export cannot reconstruct what
  a child said. Nothing leaves the device: no network, no storage, no
  identifiers.
- Session video/audio, if recorded at all, needs the parent's consent and
  the child's assent in their own words, and is deleted after analysis.
- The researcher's notes are the only place a child's words appear, and
  they are pseudonymised at the time of writing, not later.

## Taking the export off the device

At the end of a session, before closing the tab, in the browser console:

```js
copy(__fieldTestSession())    // full session: summary + raw events
__fieldTestSummary()          // just the four measures, to eyeball
```

A console handle rather than a button, for two reasons: a six-year-old
must not be able to reach it mid-session, and a field site may have no
network.

## What would make us stop and fix before continuing

- A child says **"I said it wrong"** about an ASR failure. That is the app
  teaching a child that it is their fault, and it outranks every other
  finding here.
- **Median repairs before tap ≥ 2** — the ladder is too long.
- A parent steps in on **more than half** of the hint moments — the hints
  are written for adults.
- Any child ends a session **wanting to stop** and unable to say what they
  did. The arc is not landing.
