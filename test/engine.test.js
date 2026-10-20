import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng, hashSeed } from '../src/rng.js';
import { generateCrowd } from '../src/persona.js';
import { SCENARIOS, getScenario, defaultLevers } from '../src/scenarios.js';
import { runCohort, compare, sensitivity, simulatePersona } from '../src/simulate.js';
import { normalCdf, wilson, mcnemar, twoProportionZ } from '../src/stats.js';

const N = 3000;
const conv = (scenario, overrides = {}) =>
  runCohort(scenario, { ...defaultLevers(scenario), ...overrides }, { n: N, seed: 11 }).conversionRate;

test('rng is deterministic per seed', () => {
  const a = new Rng(123);
  const b = new Rng(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  assert.notEqual(new Rng(1).next(), new Rng(2).next());
  assert.notEqual(hashSeed(1, 'a'), hashSeed(1, 'b'));
});

test('normal draws have roughly the requested moments', () => {
  const rng = new Rng(9);
  const xs = Array.from({ length: 20000 }, () => rng.normal(5, 2));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  assert.ok(Math.abs(mean - 5) < 0.05);
  assert.ok(Math.abs(sd - 2) < 0.05);
});

test('crowds are reproducible and follow segment shares', () => {
  const s = getScenario('checkout');
  const a = generateCrowd(s, 4000, 5);
  const b = generateCrowd(s, 4000, 5);
  assert.deepEqual(a, b);
  for (const seg of s.segments) {
    const share = a.filter((p) => p.segment === seg.id).length / a.length;
    assert.ok(Math.abs(share - seg.share) < 0.03, `${seg.id} share ${share}`);
  }
  for (const p of a) for (const v of Object.values(p.traits)) assert.ok(v >= 0 && v <= 1);
});

test('every scenario produces a sane, monotone funnel', () => {
  for (const s of SCENARIOS) {
    const r = runCohort(s, defaultLevers(s), { n: 2000 });
    for (let i = 1; i < r.funnel.length; i++) assert.ok(r.funnel[i].count <= r.funnel[i - 1].count);
    assert.ok(r.conversionRate > 0.02 && r.conversionRate < 0.8, `${s.id} conversion ${r.conversionRate}`);
    assert.ok(r.statedRate > r.conversionRate, `${s.id}: people should over-state intent`);
    const m = r.matrix;
    assert.equal(m.yesBought + m.yesLeft + m.noBought + m.noLeft, r.n);
    assert.equal(r.reasons.reduce((sum, x) => sum + x.count, 0), r.n - r.converted);
  }
});

test('the say-do gap emerges in a realistic range', () => {
  const r = runCohort(getScenario('checkout'), defaultLevers(getScenario('checkout')), { n: 5000 });
  assert.ok(r.sayDoGap > 0.35 && r.sayDoGap < 0.7, `gap ${r.sayDoGap}`);
});

test('higher prices lower conversion in every scenario', () => {
  for (const s of SCENARIOS) {
    const lever = s.levers.find((l) => l.key === 'price' || l.key === 'fare');
    assert.ok(conv(s, { [lever.key]: lever.min }) > conv(s, { [lever.key]: lever.max }), s.id);
  }
});

test('friction hurts: form fields, load time, forced accounts', () => {
  const s = getScenario('checkout');
  assert.ok(conv(s, { formFields: 4 }) > conv(s, { formFields: 20 }));
  assert.ok(conv(s, { loadTime: 0.5 }) > conv(s, { loadTime: 8 }));
  assert.ok(conv(s, { guestCheckout: true }) > conv(s, { guestCheckout: false }));
});

test('hidden fees widen the say-do gap; transparency narrows it', () => {
  const s = getScenario('checkout');
  const base = defaultLevers(s);
  const hidden = runCohort(s, { ...base, shipping: 15, shippingReveal: 'checkout' }, { n: N });
  const shown = runCohort(s, { ...base, shipping: 15, shippingReveal: 'upfront' }, { n: N });
  // Same survey (it never mentions shipping), so stated intent is identical...
  assert.equal(hidden.statedRate, shown.statedRate);
  // ...but behaviour differs.
  assert.ok(hidden.sayDoGap > shown.sayDoGap);
  assert.ok(hidden.reasons.some((x) => x.key === 'shipping_surprise'));
  assert.ok(!shown.reasons.some((x) => x.key === 'shipping_surprise'));
});

test('clickbait trades clicks for subscriptions', () => {
  const s = getScenario('paywall');
  const bait = runCohort(s, { ...defaultLevers(s), clickbait: 1 }, { n: N });
  const sober = runCohort(s, { ...defaultLevers(s), clickbait: 0 }, { n: N });
  const clicks = (r) => r.funnel[1].rate;
  assert.ok(clicks(bait) > clicks(sober), 'clickbait should win the click');
  assert.ok(sober.conversionRate > bait.conversionRate, 'but lose the subscriber');
});

test('identical variants produce zero discordant pairs (common random numbers)', () => {
  const s = getScenario('flight');
  const res = compare(s, defaultLevers(s), defaultLevers(s), { n: 1500 });
  assert.equal(res.switchedOn, 0);
  assert.equal(res.switchedOff, 0);
  assert.equal(res.test.p, 1);
});

test('a clearly better variant is detected as significant', () => {
  const s = getScenario('checkout');
  const a = defaultLevers(s);
  const b = { ...a, guestCheckout: true, formFields: 6, shippingReveal: 'upfront', loadTime: 1 };
  const res = compare(s, a, b, { n: 2000 });
  assert.ok(res.lift > 0.05);
  assert.ok(res.test.p < 0.001);
});

test('trace mode matches the fast path exactly', () => {
  const s = getScenario('checkout');
  const crowd = generateCrowd(s, 200, 3);
  const L = defaultLevers(s);
  for (const p of crowd) {
    const fast = simulatePersona(s, p, L, 3);
    const slow = simulatePersona(s, p, L, 3, { trace: true });
    assert.equal(fast.converted, slow.converted);
    assert.equal(fast.said, slow.said);
    assert.equal(fast.reason, slow.reason);
    assert.ok(slow.steps.every((st) => typeof st.thought === 'string' && st.thought.length > 0));
  }
});

test('sensitivity ranks levers by impact', () => {
  const s = getScenario('flight');
  const res = sensitivity(s, defaultLevers(s), { n: 800 });
  assert.equal(res.rows.length, s.levers.length);
  for (let i = 1; i < res.rows.length; i++) assert.ok(res.rows[i].span <= res.rows[i - 1].span);
});

test('statistics helpers', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  const ci = wilson(50, 100);
  assert.ok(ci.low < 0.5 && ci.high > 0.5);
  assert.equal(mcnemar(0, 0).p, 1);
  assert.ok(mcnemar(10, 60).p < 0.001);
  assert.ok(twoProportionZ(100, 1000, 150, 1000).p < 0.01);
});
