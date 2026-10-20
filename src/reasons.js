// Every force that can push a persona forward or backward has a key. Keys map
// to a human-readable drop-off reason and to "think-aloud" lines, so each
// synthetic journey can be read as an inner monologue.
//
// Template context: { p, L, money, price }

const r = (label, neg = [], pos = []) => ({ label, neg, pos });

export const REASONS = {
  interest: r(
    'Low purchase intent',
    [() => 'Do I really need this right now?', () => 'Eh, maybe some other time.'],
    [() => 'I actually need this.', () => 'This is exactly what I was looking for.'],
  ),
  slow: r(
    'Slow pages',
    [(c) => `Still loading... ${c.L.loadTime.toFixed(1)}s and counting.`, () => 'Why is this so slow?'],
  ),
  social: r(
    'Weak social proof',
    [() => 'Barely any reviews. Hmm.', () => 'Nobody seems to be talking about this.'],
    [() => 'Tons of good reviews. People love it.', () => 'Everyone seems to be getting one.'],
  ),
  price: r(
    'Price higher than they would pay',
    [
      (c) => `${c.money(c.price)}? I had ${c.money(c.p.wtp)} in mind.`,
      (c) => `${c.money(c.price)} is too much for me.`,
    ],
    [(c) => `${c.money(c.price)} feels fair.`, () => 'Good value for the money.'],
  ),
  trust: r('Trust signals', [], [() => 'Secure checkout badges. Good.', () => 'Looks legit.']),
  distrust: r(
    "Didn't trust the site",
    [() => 'Is this site even legit?', () => "I'm not typing my card details here."],
  ),
  urgency: r('Urgency', [], [() => 'Only minutes left? Better grab it!', () => 'Countdown! Go go go.']),
  urgency_backfire: r(
    'Pressure tactics backfired',
    [() => 'A countdown timer? Classic pressure trick.', () => "Don't rush me. Closing this."],
  ),
  impulse: r('Impulse', [() => 'Let me sleep on it.'], [() => 'Oh, I want it.', () => 'Treat yourself.']),
  brand: r(
    'Unfamiliar brand',
    [() => 'Never heard of this brand.'],
    [() => 'I know this brand. Easy choice.', () => 'Back to my usual place.'],
  ),
  hesitation: r(
    'Second thoughts at the cart',
    [() => "I'll come back to this later...", () => 'Let me compare a few other options first.'],
  ),
  form: r(
    'Too many form fields',
    [
      (c) => `${c.L.formFields} fields?! On my ${c.p.mobile ? 'phone' : 'laptop'}?`,
      () => 'Why do they need all of this?',
    ],
  ),
  account: r(
    'Forced account creation',
    [() => 'I have to create an account just to buy this?', () => 'Not another password.'],
  ),
  shipping_surprise: r(
    'Surprise shipping fee',
    [
      (c) => `Wait, ${c.money(c.L.shipping)} shipping NOW?!`,
      () => 'They hid the shipping cost until the end. Nope.',
    ],
  ),
  fatigue: r(
    'Decision fatigue',
    [() => 'This is taking forever.', () => "I'm tired of clicking through this."],
  ),
  distracted: r(
    'Got distracted',
    [() => 'Oh, a notification... (tab closed)', () => '(wandered off to another app)'],
  ),
  // Aviation
  flex: r('Flexibility', [], [() => 'Free cancellation. No risk.']),
  no_flex: r(
    'No free cancellation',
    [() => 'Non-refundable? What if my plans change?'],
  ),
  bag_surprise: r(
    'Hidden bag fee',
    [
      (c) => `${c.money(c.L.bagFee)} for a suitcase?! That wasn't in the fare.`,
      () => 'So the cheap fare was never the real fare.',
    ],
  ),
  dark_pattern: r(
    'Pre-ticked add-ons',
    [() => 'Who pre-ticked travel insurance for me?', () => 'Sneaky add-ons. Not cool.'],
  ),
  price_shock: r(
    'Fare changed at payment',
    [() => 'The price just went up at the last step?!', () => 'Bait and switch. Closing.'],
  ),
  // Media
  curiosity: r('Curiosity', [], [() => "You won't believe... okay, fine, I'll click.", () => 'Huh, interesting.']),
  clickbait_distrust: r(
    'Clickbait put them off',
    [() => 'Another clickbait headline. Scroll.', () => "I don't click on that kind of headline."],
  ),
  ads: r('Ad overload', [() => 'More ads than article.', () => 'Pop-up, banner, video ad... gone.']),
  bait_letdown: r(
    'Headline over-promised',
    [() => 'That headline promised way more than this.', () => 'Well, that was a letdown.'],
  ),
  free_enough: r(
    'Free articles were enough',
    [() => 'The free articles are enough for me.'],
  ),
  habit: r('Habit', [], [() => 'I keep coming back to this outlet.', () => 'This is part of my morning now.']),
  hard_wall: r('Hard paywall', [() => 'A paywall on the very first article? Bye.']),
  trial: r('Free trial', [], [(c) => `${c.L.trialDays} days free. Nothing to lose.`]),
  credibility: r(
    'Low credibility',
    [() => 'Pay for a site that baits its headlines? No.'],
  ),
  card_upfront: r(
    'Card required for trial',
    [() => "Card details for a 'free' trial... I know how this ends."],
  ),
};

export function reasonLabel(key) {
  return REASONS[key]?.label ?? key;
}

const FALLBACK_PASS = ['Okay, next.', 'Fine, continuing.', 'Sure.'];

// Picks a monologue line for one stage from the dominant force.
export function monologue(forces, passed, ctx, rand) {
  const sorted = [...forces].sort((a, b) => a.value - b.value);
  const choose = (arr) => arr[Math.floor(rand * arr.length) % arr.length];

  if (!passed) {
    const worst = sorted[0];
    const key = worst && worst.value < -0.2 ? worst.key : 'distracted';
    const lines = REASONS[key]?.neg ?? REASONS.distracted.neg;
    return choose(lines.length ? lines : REASONS.distracted.neg)(ctx);
  }

  // Voice the strongest force that hasn't been voiced yet on this journey,
  // so the monologue moves on instead of repeating itself.
  const used = ctx.used ?? new Set();
  const worst = sorted[0];
  if (worst && worst.value < -0.4 && !used.has(worst.key) && REASONS[worst.key]?.neg.length) {
    used.add(worst.key);
    return `${choose(REASONS[worst.key].neg)(ctx)} (continues anyway)`;
  }
  const best = [...sorted].reverse().find((x) => x.value > 0.25 && !used.has(x.key) && REASONS[x.key]?.pos.length);
  if (best) {
    used.add(best.key);
    return choose(REASONS[best.key].pos)(ctx);
  }
  return choose(FALLBACK_PASS);
}
