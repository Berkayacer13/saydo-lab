// Deterministic, seedable randomness. Every simulation in SayDo Lab is
// reproducible: the same seed always produces the same crowd and the same
// journeys, which is what makes paired A/B comparisons possible.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a hash over the joined parts, used to derive independent sub-streams
// (one per persona, one per crowd, ...) from a single user-facing seed.
export function hashSeed(...parts) {
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
    this.spare = null;
  }

  uniform(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  chance(p) {
    return this.next() < p;
  }

  // Box-Muller with a cached spare value.
  normal(mean = 0, sd = 1) {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return mean + sd * z;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mean + sd * r * Math.cos(2 * Math.PI * v);
  }

  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  // items: [{ weight, ... }]
  weighted(items, key = 'weight') {
    const total = items.reduce((s, it) => s + it[key], 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= it[key];
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const clamp01 = (x) => clamp(x, 0, 1);
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
