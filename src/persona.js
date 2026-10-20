import { Rng, hashSeed, clamp, clamp01 } from './rng.js';

// Psychographic traits every synthetic persona carries, all on a 0..1 scale.
export const TRAITS = [
  'priceSensitivity',
  'impulsivity',
  'trustNeed',
  'patience',
  'socialInfluence',
  'lossAversion',
  'brandAffinity',
  'socialDesirability',
];

export const TRAIT_LABELS = {
  priceSensitivity: 'Price sensitivity',
  impulsivity: 'Impulsivity',
  trustNeed: 'Need for trust',
  patience: 'Patience',
  socialInfluence: 'Social influence',
  lossAversion: 'Loss aversion',
  brandAffinity: 'Brand affinity',
  socialDesirability: 'Says what sounds good',
};

const NAMES = [
  'Ada', 'Mert', 'Lena', 'Kenji', 'Zeynep', 'Omar', 'Sofia', 'Luca', 'Aylin', 'Noah',
  'Priya', 'Mateo', 'Elif', 'Jonas', 'Mira', 'Diego', 'Hana', 'Theo', 'Defne', 'Ravi',
  'Clara', 'Emre', 'Yuki', 'Leo', 'Nadia', 'Arda', 'Ines', 'Sami', 'Ece', 'Felix',
  'Amara', 'Can', 'Maya', 'Tariq', 'Selin', 'Oscar', 'Lina', 'Burak', 'Nora', 'Kai',
];

const TRAIT_SPREAD = 0.13;

// Builds a reproducible synthetic crowd from a scenario's segment definitions.
// Each segment describes trait *means*; individuals vary around them, so two
// "Bargain Hunters" are similar but never identical.
export function generateCrowd(scenario, n, seed = 42) {
  const rng = new Rng(hashSeed(seed, 'crowd', scenario.id));
  const segments = scenario.segments.map((s) => ({ ...s, weight: s.share }));
  const crowd = [];

  for (let i = 0; i < n; i++) {
    const seg = rng.weighted(segments);
    const traits = {};
    for (const t of TRAITS) {
      traits[t] = clamp01(rng.normal(seg.traits[t] ?? 0.5, seg.spread ?? TRAIT_SPREAD));
    }

    const flags = {};
    for (const [flag, p] of Object.entries(seg.flags ?? {})) flags[flag] = rng.chance(p);

    // Willingness to pay is log-normal around the scenario's reference price,
    // shifted per segment and pulled down by individual price sensitivity.
    const wtp =
      scenario.referencePrice *
      Math.exp(rng.normal((seg.wtpBias ?? 0) - 0.35 * (traits.priceSensitivity - 0.5), 0.26));

    crowd.push({
      id: i,
      name: rng.pick(NAMES),
      age: Math.round(clamp(rng.normal(seg.age ?? 35, 8), 18, 79)),
      segment: seg.id,
      mobile: rng.chance(seg.mobileShare ?? 0.5),
      motivation: clamp01(rng.normal(seg.motivation ?? 0.6, 0.22)),
      wtp,
      traits,
      flags,
    });
  }
  return crowd;
}
