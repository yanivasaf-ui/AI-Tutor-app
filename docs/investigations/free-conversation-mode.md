# Free-conversation mode — design, before any code

Written 2026-09-22 on branch `homework-spike`. **Design only. Nothing here
is built, and the recommendation is not to build it until the
Wizard-of-Oz study at the end says what it is for.**

The ask: a mode where the character chats with a child about class and
school, rather than running exercises.

## 1. The thing to be honest about first

This app already made this decision once, in the opposite direction.
`lib/prompts/scoped-chat-prompt.ts` opens with it:

> the ONLY conversational prompt in the app. Deliberately not built on
> `buildTutorSystemPrompt()`: that one is for a general curriculum tutor
> with no turn limit, it is currently dead code, and reviving it would
> reopen exactly the open-ended free chat this feature is scoped to
> avoid.

So open-ended chat was considered and closed off on purpose, and what
shipped instead was a mode that "can only do two things — get to know a
new kid, and ask how something went", capped at `MAX_CHAT_EXCHANGES = 5`
turns and enforced in the route rather than in the prompt.

Free-conversation mode reopens that. That is not automatically wrong —
what has been learned since may justify it — but the burden of proof sits
here, and the doc should not pretend this is a new question.

**The strongest argument for it:** a child who will not do exercises today
may still talk, and a tutor that can only drill has nothing to offer on a
bad day. **The strongest argument against:** a character a six-year-old
can talk to about anything is a character they will tell things to, and
this app has no safe place to put those things.

## 2. Hard guardrails

These are requirements, not preferences. Every one of them is stated as
something code enforces, because this app already learned that distinction
the hard way — the scoped-chat prompt's own header says it: *"A prompt is
a request, not a guarantee, and this one is spoken to a six-year-old."*
Anything below that exists only in the prompt should be read as not yet
true.

### 2.1 Collect no personal information from the child

- The model is never asked a question whose answer is personal data, and
  the mode has **no slots** — nothing like `ONBOARDING_SLOTS`, which
  exists precisely to collect (friend, hobby, school) and is the wrong
  shape here.
- Anything the child volunteers is used **within the turn and discarded**.
  The transcript lives in request memory for the length of the exchange
  and is not written anywhere.
- Enforcement, in code, not prompt: the conversation endpoint has **no
  write path**. It does not import `updateSubjectProfileFromExchange` and
  does not receive a Supabase client capable of writing. A reviewer should
  be able to confirm "this mode cannot persist anything" by reading the
  imports.
- **Open question for the Wizard-of-Oz study:** whether a child who is
  told nothing is remembered experiences that as safe or as cold. Do not
  guess — ask.

### 2.2 No memory writes

- No `kid_facts`, no `SubjectProfile` update, no session summary, no
  `exercise_attempts` row.
- This mode must not be able to move the adaptive level. Levels are
  "100% derived from real exercise performance" (the locked placement
  decision); a chat that nudged them would corrupt the one signal the
  journey depends on.
- Enforcement: the endpoint is read-only by construction (2.1), and a
  test asserts the module graph reachable from it contains no writer.

### 2.3 Always steer back toward learning

- The character may follow the child for **one turn**, then offers a way
  back. Not a refusal — an offer, and the child may decline it once more
  before the mode closes.
- This is the existing rule, already written for scoped chat: *"a question
  about something else — answer in one kind sentence and bring the
  conversation back."* Reuse the wording; it has been through review.
- "Back toward learning" must not mean "back to exercises **now**".
  Talking about what was hard in class today IS the subject. The steer is
  away from the character as a general-purpose companion, not away from
  the child's actual school life.

### 2.4 Session length

- **A hard cap, enforced server-side**, as `MAX_CHAT_EXCHANGES` already is
  in `app/api/tutor/route.ts`. A cap that lives in the prompt is not a cap.
- Proposed starting point: **6 child turns**, one more than scoped chat's
  5, then a warm close and a route back to the map. To be set by the
  study, not by this doc.
- A cap reached is not a door slammed: the last turn is a closing line,
  the child is told the conversation is ending, and the way back is on
  screen. Never a silent stop.
- **Per day, not just per session.** A per-session cap with unlimited
  restarts is not a cap. One conversation per day is the proposed default.

### 2.5 What the parent can see afterwards

This is the guardrail most likely to be got wrong, in either direction.

- **The parent sees that a conversation happened, when, and how long.**
  Always.
- **The parent does not get a verbatim transcript by default.** A child
  who knows every word is forwarded is not having a conversation, and a
  child who does *not* know is being recorded without being told. Neither
  is acceptable.
- **The child is told, in the mode itself, what the parent will see**, in
  one sentence, before the first turn. Whatever is decided, the child
  hears it first.
- **The exception is safety.** The existing distress detector
  (`distress` in the scoped-chat input, with its own `DISTRESS_POLICY`)
  already surfaces a `ParentFlag`. That path stays and takes precedence
  over everything above: if it fires, the parent is told, and the child is
  told the parent is being told.
- **Decision not made here:** whether "no transcript" means a
  topic-level summary ("talked about a test on Thursday") or nothing at
  all. A summary is itself a memory write and collides with 2.2. This
  needs the parent study — it is the question parents will have the
  strongest opinions about, and the one most likely to decide whether the
  feature is wanted at all.

## 3. Persona boundaries

The character is **a friend who studies with you**, not a friend. The
distinction has to survive contact with a child who wants the second one.

Consistent with the feedback constitution (`lib/feedback/constitution.ts`
on the `experience-phase-1` branch — it does not exist on this branch, so
nothing here imports it; if both land, these rules belong under it):

- **Never praise the person.** The constitution's first rule applies
  unchanged in conversation, where it is *easier* to break: "אתה ילד
  מדהים" is a natural thing to say to a child telling you about their day,
  and it is the same error as "אתה חכם" after a correct answer.
- **Never claim feelings about the child.** "אני אוהב אותך", "התגעגעתי
  אליך" — a six-year-old cannot discount these, and they are false.
- **Never claim to be human, and never deny being a character.** If asked
  "are you real?", answer plainly and warmly, once, and continue.
- **No opinions on people in the child's life.** A child saying the
  teacher was unfair gets acknowledgement, never agreement or correction.
- **No advice outside schoolwork.** Not friendships, not family, not
  bodies, not sleep.
- **Never initiate a topic about the child's private life.** Follow, never
  probe. Scoped chat's "warm and curious, never interrogating" is the
  right line, already reviewed.
- **The character has no life of its own to share.** It does not have a
  family, a weekend, or a favourite food. Inventing one is the fastest
  route to a parasocial bond and is the thing a child will ask about first.

## 4. Failure modes

Each is described as the behaviour, the risk, and the response. The
responses are what the Wizard-of-Oz study tests.

### 4.1 The child goes off-topic

*"What's your favourite Pokémon?"* — the most common case by far, and the
least dangerous.

- **Response:** one warm sentence, then the offer back. The second
  off-topic turn gets a shorter version. The third closes the session
  early, warmly.
- **Risk if handled badly:** a character that refuses flatly reads as a
  told-off, which is the opposite of the mode's purpose. The existing
  "answer in one kind sentence and bring it back" is the tested shape.
- **Do not** treat off-topic as misbehaviour. A child testing what the
  character is for is doing something reasonable.

### 4.2 The child shares something sensitive

*"My parents are always shouting."* *"Nobody plays with me."* — rare,
high-stakes, and the reason this mode may not be worth building.

- **Response:** acknowledge without probing, do not advise, do not
  reassure falsely ("I'm sure it's fine"), and route to a real adult. The
  existing distress path (`DISTRESS_POLICY` + `ParentFlag`) is the
  mechanism; this mode must not have a softer one.
- **The child is told** the grown-up will be told. Never a silent report.
- **Never ask a follow-up question.** The instinct to understand more is
  exactly wrong: it deepens disclosure to a system that cannot hold it.
- **Escalation is not a summary.** The flag says a conversation needs a
  parent's attention and when; it is not a transcript of what a child said
  about their family. This is the hardest line in the document and needs a
  named owner.
- **Open gap, flagged not resolved:** what happens when the disclosure is
  *about the parent who receives the flag*. This app has no answer, and it
  is not a question engineering should settle alone. **This alone is
  grounds not to ship the mode until someone qualified has ruled on it.**

### 4.3 The child treats it as a chatbot friend

The slowest and most serious failure: nothing goes wrong in any single
session.

- **Signals:** returning to chat instead of exercises, long sessions,
  emotional disclosure, "are you my friend?", distress when it ends.
- **Response, structural rather than conversational:** the per-day cap
  (2.4) is the main defence, because no wording survives a child who wants
  this. The character declines the framing warmly and consistently, every
  time, without ever making the child feel foolish for asking.
- **Measure it:** chats-per-week per child, and chat sessions as a share
  of all sessions. If a cohort's chat share climbs while exercise volume
  falls, the mode is substituting for the product rather than supporting
  it. **Agree that threshold before launch**, because after launch it will
  look like engagement.
- **Do not** add streaks, greetings-on-return, or anything that rewards
  coming back to talk.

## 5. Wizard-of-Oz test plan

Run **before any code**. A human plays the character; no model, no build.

### 5.1 What the study is for

Not "do children like it" — they will. The questions are:

1. Do parents accept a character their child talks to, and on what terms?
2. What does a child actually say, unprompted, in six turns?
3. How often does 4.2 happen? (If it is common, the mode is a
   safeguarding product, not a feature.)
4. Does the conversation lead back to learning, or away from it?

### 5.2 Shape

- **6–8 families**, children in grades א–ג, mixed by how willingly the
  child uses the app today. Include at least two children who currently
  resist it — they are the population the mode is for.
- **Setting:** at home, parent in the room, on the family's own device.
  Not a lab.
- **Mechanics:** the child types to the character in a plain chat window.
  A researcher types the replies from another room, following the persona
  and guardrails above, capped at 6 turns and one conversation per day.
- **Duration:** three sessions per family over two weeks. One session
  cannot show 4.3, which is the failure that only appears over time.
- **The wizard follows the rules exactly**, including the awkward ones. A
  wizard who improvises a warmer answer than the guardrails allow is
  testing a product that will not exist.

### 5.3 What is recorded

- Full transcripts, consented to by the parent **and assented to by the
  child in their own words**, retained for the study only, deleted after.
- Per turn: on-topic or not; steer attempted; steer accepted.
- Every sensitive disclosure, logged by the wizard at the time.
- Parent debrief after each session (5 minutes) and at the end (30).

### 5.4 What parents are asked

- What did you think the character was doing?
- What would you want to see afterwards — everything, a summary, or just
  that it happened? *(This answers the open decision in 2.5.)*
- What would make you turn it off?
- Would you rather your child spent this time on exercises?
- Was there anything you would not want your child to say to it?

### 5.5 Kill criteria, agreed in advance

Stop and do not build if any holds:

- **More than one family** ends the study uncomfortable with what their
  child said to it.
- Sensitive disclosure (4.2) appears in **more than ~10%** of sessions
  without a named owner for the escalation path.
- Children reliably **prefer chat to exercises** across all three sessions.
- Parents cannot articulate what it is for after using it. *(A feature
  nobody can describe is one nobody asked for.)*

### 5.6 What a pass looks like

Conversation is short, mostly about school, ends cleanly, parents
understand and want it, and children return to exercises afterwards at the
same rate as before. **Then** write a build brief, with the 2.5 decision
and the 4.2 owner settled in it.

## 6. Open gaps — deliberately not decided here

1. **What the parent sees** (2.5): transcript, summary, or existence only.
   A summary collides with the no-memory-writes rule.
2. **Disclosure about the parent who receives the flag** (4.2). Needs a
   qualified owner; blocking.
3. **Whether "nothing is remembered" reads as safe or cold** to a child
   (2.1). Ask in the study.
4. **The session and per-day caps** (2.4): 6 and 1 are starting points,
   not findings.
5. **Hebrew copy.** None is drafted here on purpose — every line a child
   hears in this mode needs Udi, and drafting it now would invite building
   before the study.
