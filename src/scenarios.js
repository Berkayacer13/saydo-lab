// Scenario definitions. A scenario is a funnel (ordered stages), a set of
// design levers a product team can pull, a synthetic population (segments),
// and two models of the same person:
//
//   survey(p, L)        -> what they SAY when asked in a clean, frictionless
//                          survey ("Would you buy this at $X?")
//   stage.forces(p, L)  -> what actually pushes them forward or backward
//                          while they DO the thing, step by step
//
// Forces are additive contributions to a logit. Forces flagged `friction`
// also accumulate into a fatigue pool that weighs on later stages.

const logRatio = (wtp, price) => Math.max(-1.6, Math.min(1, Math.log(wtp / price)));
const over = (x, threshold) => Math.max(0, x - threshold);

const f = (key, value, friction = false) => ({ key, value, friction });

// ---------------------------------------------------------------------------
// E-commerce: checkout funnel
// ---------------------------------------------------------------------------
const checkout = {
  id: 'checkout',
  sector: 'E-commerce',
  name: 'Checkout funnel',
  product: 'Trail running shoes',
  blurb:
    'Shoppers clicked an ad for trail running shoes. In a survey most say they would buy them. How many actually get through your checkout?',
  currency: '$',
  referencePrice: 89,
  priceOf: (L) => L.price,
  surveyQuestion: (L) => `Would you buy these shoes for $${L.price}?`,
  segments: [
    {
      id: 'bargain', label: 'Bargain Hunter', share: 0.24, age: 31, mobileShare: 0.65, wtpBias: -0.1, motivation: 0.6,
      traits: { priceSensitivity: 0.85, impulsivity: 0.35, trustNeed: 0.5, patience: 0.62, socialInfluence: 0.55, lossAversion: 0.8, brandAffinity: 0.25, socialDesirability: 0.45 },
    },
    {
      id: 'busy', label: 'Busy Professional', share: 0.22, age: 38, mobileShare: 0.7, wtpBias: 0.18, motivation: 0.65,
      traits: { priceSensitivity: 0.3, impulsivity: 0.5, trustNeed: 0.5, patience: 0.22, socialInfluence: 0.3, lossAversion: 0.4, brandAffinity: 0.45, socialDesirability: 0.5 },
    },
    {
      id: 'cautious', label: 'Cautious Planner', share: 0.2, age: 52, mobileShare: 0.3, wtpBias: 0, motivation: 0.55,
      traits: { priceSensitivity: 0.55, impulsivity: 0.15, trustNeed: 0.88, patience: 0.75, socialInfluence: 0.4, lossAversion: 0.7, brandAffinity: 0.35, socialDesirability: 0.6 },
    },
    {
      id: 'impulse', label: 'Impulse Scroller', share: 0.2, age: 24, mobileShare: 0.92, wtpBias: 0.05, motivation: 0.5,
      traits: { priceSensitivity: 0.45, impulsivity: 0.88, trustNeed: 0.3, patience: 0.18, socialInfluence: 0.82, lossAversion: 0.35, brandAffinity: 0.3, socialDesirability: 0.55 },
    },
    {
      id: 'loyal', label: 'Loyal Regular', share: 0.14, age: 41, mobileShare: 0.5, wtpBias: 0.22, motivation: 0.75,
      traits: { priceSensitivity: 0.35, impulsivity: 0.4, trustNeed: 0.35, patience: 0.6, socialInfluence: 0.25, lossAversion: 0.4, brandAffinity: 0.85, socialDesirability: 0.4 },
    },
  ],
  levers: [
    { key: 'price', label: 'Price', type: 'range', min: 49, max: 149, step: 1, default: 89, unit: '$' },
    { key: 'shipping', label: 'Shipping fee', type: 'range', min: 0, max: 20, step: 1, default: 9, unit: '$' },
    {
      key: 'shippingReveal', label: 'Shipping cost shown', type: 'select', default: 'checkout',
      options: [{ value: 'upfront', label: 'On product page' }, { value: 'checkout', label: 'Only at checkout' }],
    },
    { key: 'socialProof', label: 'Social proof (reviews)', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4, unit: '%' },
    { key: 'trustBadges', label: 'Trust badges', type: 'toggle', default: false },
    { key: 'urgency', label: 'Countdown timer', type: 'toggle', default: false },
    { key: 'guestCheckout', label: 'Guest checkout', type: 'toggle', default: false },
    { key: 'formFields', label: 'Checkout form fields', type: 'range', min: 4, max: 20, step: 1, default: 12 },
    { key: 'loadTime', label: 'Page load time', type: 'range', min: 0.5, max: 8, step: 0.1, default: 2.5, unit: 's' },
  ],
  survey(p, L) {
    const t = p.traits;
    return 2.4 * logRatio(p.wtp, L.price) * (0.5 + t.priceSensitivity) + 1.5 * t.socialDesirability + 3.0 * (p.motivation - 0.5) - 0.3;
  },
  stages: [
    {
      id: 'landing', label: 'Landing page', base: 2.3,
      forces: (p, L) => [
        f('slow', -0.32 * over(L.loadTime, 1) * (1.3 - p.traits.patience) * (p.mobile ? 1.25 : 1), true),
        f('interest', 1.6 * (p.motivation - 0.5)),
        f('social', 0.6 * L.socialProof * p.traits.socialInfluence),
      ],
    },
    {
      id: 'product', label: 'Product page', base: 1.5,
      forces: (p, L) => {
        const t = p.traits;
        const shown = L.price + (L.shippingReveal === 'upfront' ? L.shipping : 0);
        const out = [
          f('price', 2.4 * logRatio(p.wtp, shown) * (0.5 + t.priceSensitivity)),
          f('social', 1.6 * (L.socialProof - 0.3) * (0.3 + t.socialInfluence)),
          f('interest', 2.8 * (p.motivation - 0.5)),
          f('impulse', 0.7 * (t.impulsivity - 0.4)),
          f('brand', 0.9 * (t.brandAffinity - 0.4)),
          L.trustBadges ? f('trust', 0.5 * t.trustNeed) : f('distrust', -0.8 * over(t.trustNeed, 0.3)),
        ];
        if (L.urgency) {
          const pull = 1.1 * t.impulsivity;
          const push = 1.0 * t.trustNeed * (1 - t.impulsivity);
          out.push(pull >= push ? f('urgency', pull - push) : f('urgency_backfire', pull - push));
        }
        return out;
      },
    },
    {
      id: 'cart', label: 'Cart', base: 2.1,
      forces: (p) => [
        f('hesitation', -0.7 * (1 - p.traits.impulsivity) * (0.4 + p.traits.lossAversion)),
        f('interest', 2.4 * (p.motivation - 0.5)),
      ],
    },
    {
      id: 'checkout', label: 'Checkout form', base: 3.4,
      forces: (p, L) => {
        const t = p.traits;
        const out = [
          f('form', -0.11 * over(L.formFields, 4) * (1.25 - t.patience) * (p.mobile ? 1.35 : 1), true),
          f('slow', -0.15 * over(L.loadTime, 1) * (1.3 - t.patience), true),
        ];
        if (!L.guestCheckout) out.push(f('account', -1.0 * (1 - t.brandAffinity), true));
        if (L.shippingReveal === 'checkout' && L.shipping > 0) {
          out.push(f('shipping_surprise', -(0.35 + (4 * L.shipping) / L.price) * (0.4 + t.lossAversion)));
        }
        return out;
      },
    },
    {
      id: 'payment', label: 'Payment', base: 2.9,
      forces: (p, L) => [
        L.trustBadges ? f('trust', 0.3 * p.traits.trustNeed) : f('distrust', -1.1 * over(p.traits.trustNeed, 0.25)),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Aviation: flight booking flow
// ---------------------------------------------------------------------------
const flight = {
  id: 'flight',
  sector: 'Aviation',
  name: 'Flight booking',
  product: 'Istanbul to Lisbon, round trip',
  blurb:
    'Travelers searched for Istanbul to Lisbon. The base fare looks great on the results page. Then come bags, add-ons and the payment step.',
  currency: '$',
  referencePrice: 240,
  priceOf: (L) => L.fare,
  surveyQuestion: (L) => `Would you book this round trip for $${L.fare}?`,
  segments: [
    {
      id: 'business', label: 'Business Traveler', share: 0.2, age: 42, mobileShare: 0.55, wtpBias: 0.35, motivation: 0.8,
      flags: { needsBag: 0.3 },
      traits: { priceSensitivity: 0.2, impulsivity: 0.45, trustNeed: 0.45, patience: 0.2, socialInfluence: 0.2, lossAversion: 0.55, brandAffinity: 0.7, socialDesirability: 0.35 },
    },
    {
      id: 'backpacker', label: 'Budget Backpacker', share: 0.24, age: 25, mobileShare: 0.85, wtpBias: -0.2, motivation: 0.6,
      flags: { needsBag: 0.35 },
      traits: { priceSensitivity: 0.9, impulsivity: 0.5, trustNeed: 0.35, patience: 0.7, socialInfluence: 0.5, lossAversion: 0.6, brandAffinity: 0.15, socialDesirability: 0.5 },
    },
    {
      id: 'family', label: 'Family Planner', share: 0.22, age: 39, mobileShare: 0.4, wtpBias: 0, motivation: 0.65,
      flags: { needsBag: 0.95 },
      traits: { priceSensitivity: 0.65, impulsivity: 0.15, trustNeed: 0.8, patience: 0.55, socialInfluence: 0.35, lossAversion: 0.85, brandAffinity: 0.4, socialDesirability: 0.6 },
    },
    {
      id: 'spontaneous', label: 'Spontaneous Getaway', share: 0.2, age: 30, mobileShare: 0.8, wtpBias: 0.05, motivation: 0.5,
      flags: { needsBag: 0.6 },
      traits: { priceSensitivity: 0.5, impulsivity: 0.85, trustNeed: 0.3, patience: 0.3, socialInfluence: 0.6, lossAversion: 0.35, brandAffinity: 0.3, socialDesirability: 0.55 },
    },
    {
      id: 'frequent', label: 'Frequent Flyer', share: 0.14, age: 47, mobileShare: 0.6, wtpBias: 0.2, motivation: 0.75,
      flags: { needsBag: 0.5 },
      traits: { priceSensitivity: 0.35, impulsivity: 0.35, trustNeed: 0.4, patience: 0.45, socialInfluence: 0.2, lossAversion: 0.5, brandAffinity: 0.9, socialDesirability: 0.35 },
    },
  ],
  levers: [
    { key: 'fare', label: 'Base fare', type: 'range', min: 120, max: 480, step: 5, default: 240, unit: '$' },
    { key: 'bagFee', label: 'Checked bag fee', type: 'range', min: 0, max: 90, step: 5, default: 45, unit: '$' },
    {
      key: 'bagReveal', label: 'Bag fee shown', type: 'select', default: 'extras',
      options: [{ value: 'upfront', label: 'With the fare' }, { value: 'extras', label: 'At the extras step' }],
    },
    { key: 'freeCancellation', label: 'Free cancellation (24h)', type: 'toggle', default: false },
    { key: 'preTicked', label: 'Pre-ticked insurance', type: 'toggle', default: true },
    { key: 'priceShock', label: 'Fare jumps at payment', type: 'toggle', default: false },
    { key: 'formFields', label: 'Passenger form fields', type: 'range', min: 6, max: 24, step: 1, default: 14 },
    { key: 'loadTime', label: 'Search load time', type: 'range', min: 1, max: 12, step: 0.5, default: 4, unit: 's' },
  ],
  survey(p, L) {
    const t = p.traits;
    return 2.4 * logRatio(p.wtp, L.fare) * (0.5 + t.priceSensitivity) + 1.4 * t.socialDesirability + 3.0 * (p.motivation - 0.5) - 0.3;
  },
  stages: [
    {
      id: 'results', label: 'Search results', base: 1.9,
      forces: (p, L) => [
        f('slow', -0.24 * over(L.loadTime, 2) * (1.3 - p.traits.patience), true),
        f('interest', 1.4 * (p.motivation - 0.5)),
      ],
    },
    {
      id: 'select', label: 'Flight selected', base: 1.8,
      forces: (p, L) => {
        const t = p.traits;
        const shown = L.fare + (L.bagReveal === 'upfront' && p.flags.needsBag ? L.bagFee : 0);
        return [
          f('price', 2.4 * logRatio(p.wtp, shown) * (0.5 + t.priceSensitivity)),
          L.freeCancellation ? f('flex', 0.9 * t.lossAversion) : f('no_flex', -0.5 * over(t.lossAversion, 0.4)),
          f('interest', 2.8 * (p.motivation - 0.5)),
          f('brand', 0.7 * (t.brandAffinity - 0.4)),
          f('impulse', 0.5 * (t.impulsivity - 0.4)),
        ];
      },
    },
    {
      id: 'passengers', label: 'Passenger details', base: 2.7,
      forces: (p, L) => [
        f('form', -0.09 * over(L.formFields, 6) * (1.25 - p.traits.patience) * (p.mobile ? 1.3 : 1), true),
        f('interest', 2.4 * (p.motivation - 0.5)),
      ],
    },
    {
      id: 'extras', label: 'Bags & extras', base: 3.0,
      forces: (p, L) => {
        const t = p.traits;
        const out = [];
        if (L.bagReveal === 'extras' && p.flags.needsBag && L.bagFee > 0) {
          out.push(f('bag_surprise', -(0.3 + (3.5 * L.bagFee) / L.fare) * (0.4 + t.lossAversion)));
        }
        if (L.preTicked) out.push(f('dark_pattern', -(0.3 + 1.2 * t.trustNeed) * (1 - 0.5 * t.impulsivity), true));
        return out;
      },
    },
    {
      id: 'payment', label: 'Payment', base: 2.8,
      forces: (p, L) => (L.priceShock ? [f('price_shock', -(0.6 + 2 * p.traits.lossAversion))] : []),
    },
  ],
};

// ---------------------------------------------------------------------------
// Media: headline to subscription
// ---------------------------------------------------------------------------
const paywall = {
  id: 'paywall',
  sector: 'Media',
  name: 'News subscription',
  product: 'Digital subscription to a daily news outlet',
  blurb:
    'Everyone says they would pay for good journalism. Follow readers from a headline in their feed all the way to the subscription form.',
  currency: '$',
  referencePrice: 7,
  priceOf: (L) => L.price,
  surveyQuestion: (L) => `Would you pay $${L.price}/month for quality journalism?`,
  segments: [
    {
      id: 'skimmer', label: 'Casual Skimmer', share: 0.3, age: 29, mobileShare: 0.9, wtpBias: -0.3, motivation: 0.35,
      traits: { priceSensitivity: 0.65, impulsivity: 0.75, trustNeed: 0.3, patience: 0.2, socialInfluence: 0.6, lossAversion: 0.4, brandAffinity: 0.2, socialDesirability: 0.6 },
    },
    {
      id: 'junkie', label: 'News Junkie', share: 0.2, age: 45, mobileShare: 0.6, wtpBias: 0.15, motivation: 0.8,
      traits: { priceSensitivity: 0.4, impulsivity: 0.5, trustNeed: 0.5, patience: 0.6, socialInfluence: 0.35, lossAversion: 0.45, brandAffinity: 0.6, socialDesirability: 0.5 },
    },
    {
      id: 'analyst', label: 'Professional Analyst', share: 0.15, age: 40, mobileShare: 0.35, wtpBias: 0.45, motivation: 0.75,
      traits: { priceSensitivity: 0.2, impulsivity: 0.2, trustNeed: 0.85, patience: 0.65, socialInfluence: 0.2, lossAversion: 0.4, brandAffinity: 0.55, socialDesirability: 0.35 },
    },
    {
      id: 'skeptic', label: 'Media Skeptic', share: 0.15, age: 50, mobileShare: 0.5, wtpBias: -0.1, motivation: 0.5,
      traits: { priceSensitivity: 0.55, impulsivity: 0.2, trustNeed: 0.92, patience: 0.5, socialInfluence: 0.25, lossAversion: 0.6, brandAffinity: 0.15, socialDesirability: 0.4 },
    },
    {
      id: 'student', label: 'Student', share: 0.2, age: 21, mobileShare: 0.95, wtpBias: -0.45, motivation: 0.55,
      traits: { priceSensitivity: 0.95, impulsivity: 0.6, trustNeed: 0.45, patience: 0.4, socialInfluence: 0.7, lossAversion: 0.5, brandAffinity: 0.25, socialDesirability: 0.7 },
    },
  ],
  levers: [
    { key: 'clickbait', label: 'Headline clickbait level', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, unit: '%' },
    { key: 'price', label: 'Monthly price', type: 'range', min: 1.99, max: 19.99, step: 1, default: 9.99, unit: '$' },
    { key: 'freeArticles', label: 'Free articles per month', type: 'range', min: 0, max: 10, step: 1, default: 3 },
    { key: 'trialDays', label: 'Free trial (days)', type: 'range', min: 0, max: 30, step: 1, default: 0 },
    { key: 'adDensity', label: 'Ad density', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5, unit: '%' },
    { key: 'loadTime', label: 'Article load time', type: 'range', min: 0.5, max: 6, step: 0.1, default: 2, unit: 's' },
  ],
  survey(p, L) {
    const t = p.traits;
    return 2.0 * logRatio(p.wtp, L.price) * (0.5 + t.priceSensitivity) + 1.8 * t.socialDesirability + 2.0 * (p.motivation - 0.5) + 0.1;
  },
  stages: [
    {
      id: 'feed', label: 'Headline in feed', base: 0.6,
      forces: (p, L) => {
        const t = p.traits;
        return [
          f('curiosity', 1.8 * L.clickbait * (0.3 + t.impulsivity)),
          f('clickbait_distrust', -1.4 * L.clickbait * t.trustNeed),
          f('interest', 1.2 * (p.motivation - 0.5)),
        ];
      },
    },
    {
      id: 'article', label: 'Reads the article', base: 1.7,
      forces: (p, L) => {
        const t = p.traits;
        return [
          f('ads', -1.6 * L.adDensity * (1.2 - t.patience), true),
          f('slow', -0.3 * over(L.loadTime, 1) * (1.3 - t.patience) * (p.mobile ? 1.2 : 1), true),
          f('bait_letdown', -1.3 * L.clickbait * (1 - 0.5 * t.impulsivity)),
        ];
      },
    },
    {
      id: 'habit', label: 'Hits the paywall', base: 1.1,
      forces: (p, L) => {
        if (L.freeArticles === 0) return [f('hard_wall', -0.6 * (1 - p.motivation))];
        return [
          f('free_enough', -0.14 * L.freeArticles * (1 - p.motivation)),
          f('interest', 1.2 * (p.motivation - 0.5)),
        ];
      },
    },
    {
      id: 'offer', label: 'Considers the offer', base: 0.1,
      forces: (p, L) => {
        const t = p.traits;
        const out = [
          f('price', 2.2 * logRatio(p.wtp, L.price) * (0.5 + t.priceSensitivity)),
          f('habit', 0.11 * L.freeArticles * p.motivation),
          f('credibility', -1.2 * L.clickbait * t.trustNeed),
          f('brand', 0.6 * (t.brandAffinity - 0.4)),
        ];
        if (L.trialDays > 0) out.push(f('trial', Math.min(1.3, 0.06 * L.trialDays) * (0.5 + t.lossAversion)));
        return out;
      },
    },
    {
      id: 'subscribe', label: 'Subscription form', base: 2.0,
      forces: (p, L) => (L.trialDays > 0 ? [f('card_upfront', -0.5 * p.traits.trustNeed)] : []),
    },
  ],
};

export const SCENARIOS = [checkout, flight, paywall];

export function getScenario(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario "${id}". Try: ${SCENARIOS.map((x) => x.id).join(', ')}`);
  return s;
}

export function defaultLevers(scenario) {
  return Object.fromEntries(scenario.levers.map((l) => [l.key, l.default]));
}
