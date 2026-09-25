# Kid picker — design (no code yet)

Status: **proposal for review.** Nothing here is implemented. Written 2026-09-25 from the multi-kid trace.

## The problem

A parent account can own several kids (`kids.parent_id`), but the kid side of the app is single-kid:

- `GET /api/kids?view=kid` returns **every** kid the parent has, in **no defined order** (`listKids` is a bare `select("*")`).
- `app/page.tsx` takes `kids[0]` and binds `KidHome` to it. The other kids can never be reached from the kid side.
- There is no way to add a second kid after the first (onboarding only runs when the list is empty), and no way to switch.
- Only the parent dashboard lists all kids.

Today no parent in production has two kids, so nobody has hit this. It blocks any real family with two children and any QA that needs two kids under one parent.

## Goals and non-goals

Goals: a parent with 2+ kids can choose who is practicing; the choice is stable and remembered; switching is safe mid-session.
Non-goals: per-kid logins or passwords, a new API route (Vercel Hobby is near its function cap; everything below fits in `/api/kids`), schema changes.

## 1. Ordering — the prerequisite, and a bug fix by itself

`listKids` must order deterministically:

```ts
supabase.from("kids").select("*").order("created_at", { ascending: true }).order("id")
```

`created_at` is the sibling order parents expect (oldest first); `id` breaks ties. Without this, `kids[0]` is whatever Postgres returns, and an `UPDATE` (a grade or avatar PATCH) can move a row's position, so the "first" kid can change under the parent. This change is safe to ship on its own, before any UI.

## 2. Entry points

| Situation | What happens |
|---|---|
| Parent has **1** kid | Unchanged: straight to that kid's home. No picker, no extra taps. |
| **2+** kids, no remembered choice (first launch on this device) | Picker screen (below) before the kid's home. |
| **2+** kids, remembered kid still exists | Straight to that kid, with a small "מי מתרגל? (שם)" switch control in the kid header. |
| Kids fetch **failed** | The retry screen (`KidsLoadError`, already shipped). Never the picker, never onboarding. |
| Parent wants another kid | "ילד/ה חדש/ה" tile on the picker, **behind the existing parent gate** (`ParentGate`). |

Switching does not go through the parent gate: a sibling tapping their own name is the point. Adding a kid does, because it creates data.

## 3. The picker screen (mock-up)

```
┌──────────────────────────────────────────┐
│                                   🔈 ⚙   │   ← mute + parent gate, same as KidHeader
│                                          │
│              מי מתרגל/ת היום?            │   ← character speaks this line too
│                                          │
│   ┌──────────────┐    ┌──────────────┐   │
│   │   [דמות]     │    │   [דמות]     │   │
│   │              │    │              │   │
│   │    נועה      │    │    דניאל     │   │
│   │   כיתה ב     │    │   כיתה א     │   │   ← name + grade chip; grade tells same-named kids apart
│   └──────────────┘    └──────────────┘   │
│                                          │
│   ┌──────────────┐                       │
│   │      +       │                       │
│   │ ילד/ה חדש/ה  │  🔒                   │   ← opens ParentGate, then Onboarding (mode "full")
│   └──────────────┘                       │
└──────────────────────────────────────────┘
```

- Tiles show the kid's own character (`avatarId`), name and grade. Two kids with the same name stay distinguishable by character and grade.
- One tap selects. The tile is spoken by name (same pattern as the topic picker's `guide.say`, including the iOS gesture rule: speak inside the tap handler).
- Up to 6 kids shown; more scroll. Suggested cap: 6 per parent, enforced in `POST /api/kids` (it has none today).
- A kid with an old avatar id that no longer normalizes goes through the existing character re-pick after selection, as now.

Switch control in the kid header (when 2+ kids):

```
  [דמות] נועה ▾          ← tap: small sheet listing the other kids + "החלף"
```

## 4. Which kid is active, and where it is remembered

- **Remembered per device** in `localStorage`, key `ai-tutor:active-kid:<parent user id>` → kid id. This mirrors the existing per-device pattern (`lib/kids/grade.ts` keeps legacy grades in `localStorage` the same way) and needs no schema change.
- On load: if the stored id is in the fetched kids → use it; if it is missing or stale (kid removed, another parent signed in) → fall back to the oldest kid, or show the picker if there are 2+ and nothing valid is stored.
- Sign-out clears nothing (the key is scoped by parent id); a different parent on the same device gets their own key.
- Alternative considered: store `active_kid_id` on the parent's row so it follows the parent across devices. Rejected for v1: it needs a migration, and "who is practicing" is a per-device fact (the family tablet vs. the parent's phone).

## 5. Switching mid-session

`KidHome` owns the session clock and practice state; `ExerciseScreen` owns the exercise in progress. Switching is a remount keyed by kid id, so nothing leaks between kids. Rules:

- **On the mode/topic screens:** switch immediately.
- **During an exercise** (`view.name === "exercise"`): ask first — "להחליף ל-דניאל? התרגיל הנוכחי לא יישמר." Confirm → switch; cancel → stay. An unanswered exercise has no attempt row yet, so nothing recorded is lost; answered ones are already saved.
- On switch: stop any speech and mic, drop prefetched lines and the prefetched next exercise (they are the previous kid's), reset the session clock for the new kid. The new kid's `openerFact` greeting plays as on any launch.
- The parent dashboard is unaffected: it already lists every kid.
- The prefetch/`excludeIds` bookkeeping is per kid already (the id list is per visit), so it must simply be reset on remount.

## 6. Edge cases

- **Same name** (two "נועה" today, across parents): tiles differ by character and grade chip.
- **A kid with no grade**: tile shows no chip; grade selection continues to work as now.
- **A kid deleted elsewhere while the app is open:** the next fetch drops it; if it was active, fall back per section 4.
- **Fetch error on refresh:** keep the current kid; the existing screens already tolerate a failed refresh.
- **Duplicate-kid guard:** because adding is now a deliberate tile, add a soft warning when the new name matches an existing kid ("כבר יש ילד בשם הזה — להוסיף בכל זאת?").

## 7. What changes in code (for the implementation, later)

1. `lib/memory/store.ts` — `listKids` ordering (section 1). Ship first.
2. `lib/kids/activeKid.ts` — pure `chooseActiveKid(kids, storedId)` returning `{ kid } | { picker: true }`, plus get/set for the storage key. Unit-tested without a DOM.
3. `components/home/KidPicker.tsx` — the screen above; `components/home/KidSwitch.tsx` — the header control.
4. `app/page.tsx` — replace `kids[0]` with `chooseActiveKid`; keep the `key={kid.id}` remount.
5. `POST /api/kids` — per-parent cap.
6. Tests: ordering; `chooseActiveKid` truth table (0/1/2+ kids × stored id valid/stale/absent); picker render; mid-exercise confirm; a two-kids-one-parent fixture for QA.

## 8. Open questions for you

1. Is **oldest-first** the right default for "who is first"? (Alternative: most recently practiced.)
2. Should switching be **ungated** (proposed) or behind the parent gate?
3. Cap of **6** kids per parent — fine?
4. Per-device memory (proposed) or per-parent (needs a migration)?
5. Should a kid who has been away for a long time still show as a tile? (Proposed: yes, always.)
