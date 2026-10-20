# How the model works

SayDo Lab is an **agent-based behavioural simulation**. Every number on screen
comes from simulating individual synthetic people. No aggregate rates are
hard-coded anywhere. This document walks through the pieces.

```
  segments ──► crowd of personas ──┬──► survey model ──► "Would you buy?"  (SAY)
                                   │
                                   └──► funnel model ──► stage by stage     (DO)
                                                           │
                                                           ├─ forces → logit → P(continue)
                                                           ├─ friction → fatigue pool
                                                           └─ exit reason + inner monologue
```

## 1. Personas

A scenario defines 5 **segments** (e.g. *Bargain Hunter*, *Family Planner*,
*Media Skeptic*). Each segment holds mean values for 8 psychographic traits on
a 0–1 scale:

| Trait | What it drives |
| --- | --- |
| `priceSensitivity` | how hard a price above willingness-to-pay hits |
| `impulsivity` | pull of urgency and curiosity, fewer second thoughts |
| `trustNeed` | penalty for missing trust signals, allergy to dark patterns |
| `patience` | tolerance for slow pages and long forms |
| `socialInfluence` | weight of reviews and social proof |
| `lossAversion` | how badly surprise fees and price jumps sting |
| `brandAffinity` | loyalty bonus and less resistance to creating an account |
| `socialDesirability` | tendency to give the "nice" answer in a survey |

Each individual is drawn around the segment means (`N(mean, 0.13)`, clamped),
so no two personas are identical. On top of the traits every persona gets:

- **Willingness to pay**: log-normal around the scenario's reference price,
  shifted per segment and pulled down by price sensitivity.
- **Motivation**: how much they *actually* need the thing. This is the true
  signal that links what they say to what they do.
- **Device** (mobile vs. desktop) and scenario flags (e.g. `needsBag`).

## 2. What people SAY: the survey model

Each persona answers a clean, frictionless survey question such as
*"Would you buy these shoes for $89?"*. The answer is a Bernoulli draw from

```
logit(say yes) = a · log(WTP / price) · (0.5 + priceSensitivity)
               + b · socialDesirability
               + c · (motivation − 0.5)
               + intercept
```

The survey only sees the headline price. It knows nothing about shipping fees,
slow pages, form length, missing trust badges or pre-ticked add-ons, and it
rewards giving a socially desirable answer. That is exactly why surveys
over-predict.

## 3. What people DO: the funnel model

The real journey is a sequence of stages (e.g. *Landing → Product → Cart →
Checkout → Payment*). At each stage the persona is pushed by a set of
**forces**, each a signed contribution to a logit:

```
P(continue) = σ( stage.base + Σ forces )
```

Examples of forces:

| Force | Fires when | Strength scales with |
| --- | --- | --- |
| `price` | price above WTP (or comfortably below) | price sensitivity |
| `shipping_surprise` | fee revealed only at checkout | loss aversion, fee / price |
| `form` | many checkout fields | (1 − patience), ×1.35 on mobile |
| `urgency` / `urgency_backfire` | countdown timer | impulsivity vs. trust need |
| `bag_surprise` | bag fee hidden until extras | loss aversion, needs a bag |
| `dark_pattern` | pre-ticked insurance | trust need |
| `curiosity` / `clickbait_distrust` | clickbait headline | impulsivity vs. trust need |
| `bait_letdown`, `credibility` | the article doesn't deliver | clickbait level |

Forces flagged as **friction** (slow pages, forms, forced accounts, ads)
accumulate into a fatigue pool, and later stages get an extra `fatigue`
force:

```
fatigue = −0.15 · accumulated_friction · (1.2 − patience)
```

Friction early in the funnel therefore costs you conversions later, even if
each later step is fine on its own.

### Exit reasons and inner monologue

When a persona drops out, the **most negative force** at that moment is
recorded as the exit reason. If no force was meaningfully negative, the reason
is *Got distracted*: people leave for no particular reason too.

In trace mode each stage also produces a short think-aloud line from the
dominant force (e.g. *"Wait, $9 shipping NOW?!"*). The inspector never voices
the same force twice in one journey, so the monologue moves forward.

## 4. Paired A/B tests with common random numbers

Every persona owns a private random stream seeded by `(seed, scenario,
persona id)`, and draws are consumed in a fixed order: one for the survey,
then one per stage. When the same crowd walks variant A and variant B, each
person rolls **the same dice** in both worlds. Any difference in their outcome
is caused by the design change, not by luck.

That turns the comparison into a paired design, so SayDo Lab uses
**McNemar's test** on the discordant pairs:

- `b` = converted under A but not under B
- `c` = converted under B but not under A
- `χ² = (|b − c| − 1)² / (b + c)`

Comparing two identical variants gives exactly `b = c = 0` (this is covered by
a unit test). Paired designs detect real effects with far fewer personas than
an unpaired two-proportion test.

## 5. Sensitivity analysis

"What moves the needle?" is a one-at-a-time sensitivity sweep. Each lever is
set to its extremes (range ends, toggle on/off, every select option) while
everything else stays fixed, on the same crowd. Levers are ranked by the spread
between their worst and best setting.

## 6. Calibration and honesty

The coefficients were hand-tuned so that default scenarios land in plausible
territory. Behavioural research on the intention-behaviour gap finds that
roughly half of the people who say they will act don't. The defaults
reproduce that:

| Scenario | Said yes | Converted | Say-do gap |
| --- | --- | --- | --- |
| Checkout funnel | ~66% | ~42% | ~54% |
| Flight booking | ~65% | ~45% | ~52% |
| News subscription | ~49% | ~7% | ~90% |

The news case is deliberately extreme. "I'd pay for good journalism" is one of
the most famous say-do gaps there is.

This is a **transparent, tunable model, not a fitted one**. The value lies in
the mechanics: seeing *why* stated intent and behaviour diverge, which levers
widen or close the gap, and which segments over-promise the most. Fitting the
coefficients to real funnel analytics and survey panels is the natural next
step (see the roadmap in the README).
