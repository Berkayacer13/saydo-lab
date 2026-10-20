import { Rng, hashSeed, sigmoid } from './rng.js';
import { generateCrowd } from './persona.js';
import { REASONS, reasonLabel, monologue } from './reasons.js';
import { mcnemar, wilson } from './stats.js';

const FATIGUE_WEIGHT = 0.15;
const DISTRACTED_THRESHOLD = -0.2;

export const money = (scenario) => (x) =>
  `${scenario.currency}${x >= 100 || Number.isInteger(x) ? Math.round(x) : x.toFixed(2)}`;

// Simulates one persona: first the survey answer, then the real journey.
//
// Each persona owns a private random stream derived from (seed, persona id),
// and the draws are consumed in a fixed order: survey first, then one draw per
// stage. That gives "common random numbers": the same person facing variant A
// and variant B rolls the same dice, so any difference in outcome is caused by
// the design change, not by luck.
export function simulatePersona(scenario, persona, levers, seed, { trace = false } = {}) {
  const rng = new Rng(hashSeed(seed, 'journey', scenario.id, persona.id));
  const said = rng.next() < sigmoid(scenario.survey(persona, levers));

  let friction = 0;
  let exitStage = -1;
  let reason = null;
  const steps = trace ? [] : null;
  const ctx = trace ? { p: persona, L: levers, money: money(scenario), price: scenario.priceOf(levers), used: new Set() } : null;

  for (let s = 0; s < scenario.stages.length; s++) {
    const stage = scenario.stages[s];
    const forces = stage.forces(persona, levers).filter((x) => Math.abs(x.value) > 1e-9);
    if (friction > 0) {
      forces.push({ key: 'fatigue', value: -FATIGUE_WEIGHT * friction * (1.2 - persona.traits.patience), friction: false });
    }
    const logit = stage.base + forces.reduce((sum, x) => sum + x.value, 0);
    const prob = sigmoid(logit);
    const u = rng.next();
    const passed = u < prob;

    for (const x of forces) if (x.friction && x.value < 0) friction += -x.value;

    if (trace) {
      steps.push({
        stage: stage.id,
        label: stage.label,
        prob,
        passed,
        forces: forces.map((x) => ({ key: x.key, value: x.value, label: reasonLabel(x.key) })),
        thought: monologue(forces, passed, ctx, u),
      });
    }

    if (!passed) {
      exitStage = s;
      const worst = forces.reduce((w, x) => (x.value < (w?.value ?? 0) ? x : w), null);
      reason = worst && worst.value < DISTRACTED_THRESHOLD ? worst.key : 'distracted';
      break;
    }
  }

  const converted = exitStage === -1;
  return trace
    ? { id: persona.id, said, converted, exitStage, reason, steps, surveyProb: sigmoid(scenario.survey(persona, levers)) }
    : { id: persona.id, said, converted, exitStage, reason };
}

// Runs a whole crowd through one design variant and aggregates the results.
export function runCohort(scenario, levers, { n = 2000, seed = 42, crowd } = {}) {
  crowd ??= generateCrowd(scenario, n, seed);
  const journeys = crowd.map((p) => simulatePersona(scenario, p, levers, seed));
  return summarize(scenario, levers, crowd, journeys, seed);
}

export function summarize(scenario, levers, crowd, journeys, seed) {
  const n = crowd.length;
  const stages = scenario.stages;

  const reached = new Array(stages.length + 1).fill(0);
  const matrix = { yesBought: 0, yesLeft: 0, noBought: 0, noLeft: 0 };
  const reasonCounts = {};
  const reasonByStage = stages.map(() => ({}));
  const segStats = Object.fromEntries(
    scenario.segments.map((s) => [s.id, { id: s.id, label: s.label, n: 0, said: 0, converted: 0, yesLeft: 0 }]),
  );

  journeys.forEach((j, i) => {
    const lastReached = j.converted ? stages.length : j.exitStage;
    for (let s = 0; s <= lastReached; s++) reached[s]++;
    if (j.said) j.converted ? matrix.yesBought++ : matrix.yesLeft++;
    else j.converted ? matrix.noBought++ : matrix.noLeft++;
    if (!j.converted) {
      reasonCounts[j.reason] = (reasonCounts[j.reason] ?? 0) + 1;
      reasonByStage[j.exitStage][j.reason] = (reasonByStage[j.exitStage][j.reason] ?? 0) + 1;
    }
    const seg = segStats[crowd[i].segment];
    seg.n++;
    if (j.said) seg.said++;
    if (j.converted) seg.converted++;
    if (j.said && !j.converted) seg.yesLeft++;
  });

  const converted = reached[stages.length];
  const said = matrix.yesBought + matrix.yesLeft;
  const exits = n - converted;

  return {
    scenario: scenario.id,
    levers: { ...levers },
    seed,
    n,
    crowd,
    journeys,
    funnel: [
      ...stages.map((s, i) => ({ id: s.id, label: s.label, count: reached[i], rate: reached[i] / n })),
      { id: 'converted', label: 'Converted', count: converted, rate: converted / n },
    ],
    converted,
    conversionRate: converted / n,
    conversionCI: wilson(converted, n),
    said,
    statedRate: said / n,
    // Share of people who SAID yes but did NOT follow through.
    sayDoGap: said ? matrix.yesLeft / said : 0,
    matrix,
    reasons: Object.entries(reasonCounts)
      .map(([key, count]) => ({ key, label: reasonLabel(key), count, share: count / exits }))
      .sort((a, b) => b.count - a.count),
    reasonByStage: reasonByStage.map((m, i) => ({
      stage: stages[i].id,
      reasons: Object.entries(m)
        .map(([key, count]) => ({ key, label: reasonLabel(key), count }))
        .sort((a, b) => b.count - a.count),
    })),
    segments: Object.values(segStats).map((s) => ({
      ...s,
      statedRate: s.n ? s.said / s.n : 0,
      conversionRate: s.n ? s.converted / s.n : 0,
      sayDoGap: s.said ? s.yesLeft / s.said : 0,
    })),
  };
}

// Paired A/B test: the exact same synthetic crowd experiences both variants.
export function compare(scenario, leversA, leversB, { n = 2000, seed = 42 } = {}) {
  const crowd = generateCrowd(scenario, n, seed);
  const a = runCohort(scenario, leversA, { crowd, seed });
  const b = runCohort(scenario, leversB, { crowd, seed });

  let onlyA = 0;
  let onlyB = 0;
  for (let i = 0; i < n; i++) {
    if (a.journeys[i].converted && !b.journeys[i].converted) onlyA++;
    if (b.journeys[i].converted && !a.journeys[i].converted) onlyB++;
  }
  const test = mcnemar(onlyA, onlyB);
  return {
    a,
    b,
    test,
    lift: b.conversionRate - a.conversionRate,
    relativeLift: a.conversionRate ? b.conversionRate / a.conversionRate - 1 : 0,
    switchedOn: onlyB,
    switchedOff: onlyA,
  };
}

// One-at-a-time sensitivity analysis ("what moves the needle?"): each lever
// is pushed to both ends of its range while everything else stays put.
export function sensitivity(scenario, levers, { n = 1500, seed = 42 } = {}) {
  const crowd = generateCrowd(scenario, n, seed);
  const base = runCohort(scenario, levers, { crowd, seed }).conversionRate;

  const rows = scenario.levers.map((lever) => {
    let values;
    if (lever.type === 'range') values = [lever.min, lever.max];
    else if (lever.type === 'toggle') values = [false, true];
    else values = lever.options.map((o) => o.value);

    const outcomes = values.map((value) => ({
      value,
      rate: runCohort(scenario, { ...levers, [lever.key]: value }, { crowd, seed }).conversionRate,
    }));
    outcomes.sort((x, y) => x.rate - y.rate);
    const worst = outcomes[0];
    const best = outcomes[outcomes.length - 1];
    return { key: lever.key, label: lever.label, current: levers[lever.key], worst, best, span: best.rate - worst.rate };
  });

  rows.sort((x, y) => y.span - x.span);
  return { base, rows };
}

export { REASONS };
