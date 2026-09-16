# Expressive-voice spike — baseline leg

**Status: incomplete by decision, not by oversight.** Only the current provider
(Cartesia) could be measured. `.env.local` carries `CARTESIA_API_KEY` and
`ANTHROPIC_API_KEY` and nothing else — no ElevenLabs, OpenAI or Azure
credential exists, so zero alternative-provider clips could be produced.
Baseline run first was the agreed call; the comparison legs run the moment
keys land.

Run: `npx tsx spike/expressive-voice/run-baseline.mts <output-dir>`
Measured 2026-09-16, dev machine, Cartesia `sonic-3.6`, `language: "he"`,
girl voice, mp3 44.1kHz/128kbps — the exact production request shape
(`lib/tts/cartesia.ts`).

## Method

Each clip is `vocalize()` (the production niqqud step, `lib/tts/vocalize.ts`)
followed by a Cartesia call, **timed separately**. Production bundles them
inside one `synthesizeSpeech()` await; the spike splits them because only the
TTS half is what a provider swap would replace — bundling them would hide
which half the latency actually lives in.

*Latency to first audio byte* = request sent → first non-empty chunk off the
response body reader. Not time-to-complete-file: it is what a child actually
waits through, and the only figure comparable across providers with different
streaming behaviour.

## Measured — Cartesia (current provider)

| # | Register | chars raw | chars vocalized | niqqud ms | TTS TTFB ms | clip |
|---|---|---|---|---|---|---|
| a | greeting | 41 | 63 | 1379 | 404 | `cartesia-a-greeting.mp3` |
| b | specific praise | 46 | 76 | 1356 | 413 | `cartesia-b-praise.mp3` |
| c | encouragement after a mistake | 51 | 78 | 1564 | 673 | `cartesia-c-encouragement.mp3` |
| d | whispered hint | 43 | 71 | 1502 | 393 | `cartesia-d-whisper.mp3` |
| e | joke | 30 | 51 | 1107 | 591 | `cartesia-e-joke.mp3` |
| | **mean** | | | **1382** | **495** | |

TTS TTFB range 393–673 ms. A second run agreed within noise (416/381/749 ms for
c/d/e), so ~400–700 ms is the real band, not a one-off.

**End-to-end, what the kid waits: ~1876 ms mean** (niqqud 1382 + TTFB 495).

## Finding 1 — the niqqud step, not the TTS, is the latency

The pre-processing costs **2.8× more time than the speech synthesis it feeds**
(1382 ms vs 495 ms). Any provider comparison that only measures TTS is
measuring the smaller half of the problem: swapping Cartesia for a provider
that is 200 ms faster moves the total by ~10%, while making the niqqud step
cacheable/faster moves it by ~70%.

This is a finding *about the in-flight voice branch*, which added that step.
Not touched here.

## Finding 2 — the niqqud step silently rewrote a word

Clip (e), sent text vs what was actually spoken:

```
sent:   מה אמר הקיר לקיר? ניפגש בפינה!
spoken: מַה אָמַר הַקִּיר לְקִיר? נִפְגַּשְׁנוּ בַּפִּינָה!
```

`ניפגש` ("we will meet", future) came back as `נִפְגַּשְׁנוּ` ("we met", past) —
the vocalizer added letters and changed the tense. Its own system prompt
forbids exactly this ("אסור לשנות אף מילה"). One in five clips, on a
five-word sentence.

The stakes are higher than a spoiled punchline: this same step sits in front of
**every** utterance including exercise questions, so it can change what a
question is asking. Worth a guard (reject any vocalization whose
consonant skeleton differs from the input, fall back to the raw text) — that
belongs to the in-flight branch's file, so it is flagged, not fixed here.

## Cost

Cartesia bills TTS at **1 credit per character**; the plan tiers are
$5 / $49 / $299 per month. Deriving $/character from the tier sizes:

| Tier | $/month | ≈ $/1M chars | $/session, 2,000 raw chars | $/session, 3,220 billed chars |
|---|---|---|---|---|
| Startup | $49 | $49 | $0.098 | $0.158 |
| Scale | $299 | $37 | $0.075 | $0.120 |

Two caveats, both material:

1. **Which tier this account is on is unknown to me** — the numbers above
   bracket it.
2. **Niqqud inflates the billed character count 1.61×** (211 raw → 339
   vocalized across the five clips). The brief's "~2,000 characters per
   session" is presumably raw text; what actually goes over the wire is
   ~3,220. Whether Cartesia counts combining marks as characters is **not
   documented publicly** (their docs are auth-gated) — settle it by reading
   credit consumption on the dashboard for a known-length pointed string, or
   by asking their support. If they do count, niqqud is a **+61% TTS bill**,
   which is a bigger cost lever than the provider choice itself.

### The 2× ceiling, ready to apply

Using the Startup tier and billed (vocalized) characters, current cost is
**$0.158/session**, so the brief's hard constraint puts the ceiling at
**$0.316/session**, i.e. **≈ $98/1M characters**. Any candidate above that is
an automatic stop-and-report, no integration.

## Still needed

| Blocker | Unblocks |
|---|---|
| `ELEVENLABS_API_KEY` in `.env.local` | ElevenLabs multilingual v2 clips + measured cost/latency |
| `OPENAI_API_KEY` in `.env.local` | OpenAI TTS clips, **and** the TTS→STT round-trip that turns "Hebrew pronunciation accuracy" into a measured character-error-rate instead of an opinion |

Pronunciation accuracy is deliberately blank above rather than guessed: it
cannot be assessed without either listening (yours) or the round-trip proxy
(needs the STT key).

## Recommendation

None yet, by design — the brief stops the spike here so the clips can be heard
first. What the numbers already say is that the decision rule should be:

- a provider is only worth the swap if it wins on **expressiveness a child
  notices** (clips d and e are the discriminating ones);
- latency is nearly a tie-breaker, not a driver, until the niqqud step is
  addressed;
- cost has ~2× headroom against the current baseline, so it will rarely be the
  binding constraint — unless niqqud is billed, in which case fix that first
  and the provider question gets cheaper either way.
