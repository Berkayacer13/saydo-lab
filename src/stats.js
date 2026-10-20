// Small, dependency-free statistics toolkit.

// Abramowitz & Stegun 7.1.26 approximation of erf (max error ~1.5e-7).
export function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Wilson score interval for a binomial proportion.
export function wilson(successes, n, z = 1.96) {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

// Unpaired two-proportion z-test (two-sided).
export function twoProportionZ(x1, n1, x2, n2) {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p2 - p1) / se;
  return { z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

// McNemar's test for paired binary outcomes. Because every persona in the
// crowd experiences BOTH variants, only the discordant pairs carry signal:
//   b = converted under A but not B, c = converted under B but not A.
export function mcnemar(b, c) {
  const discordant = b + c;
  if (discordant === 0) return { b, c, chi2: 0, p: 1 };
  const chi2 = (Math.abs(b - c) - 1) ** 2 / discordant;
  const p = 2 * (1 - normalCdf(Math.sqrt(chi2)));
  return { b, c, chi2, p: Math.min(1, p) };
}

export function formatP(p) {
  if (p < 0.001) return 'p < 0.001';
  return `p = ${p.toFixed(3)}`;
}
