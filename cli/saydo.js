#!/usr/bin/env node
// SayDo Lab command line interface.
//
//   node cli/saydo.js checkout
//   node cli/saydo.js checkout --set price=79 --set guestCheckout=true
//   node cli/saydo.js flight --compare "bagReveal=upfront,preTicked=false"
//   node cli/saydo.js paywall --sensitivity --n 3000 --seed 7
//   node cli/saydo.js checkout --persona 12
//   node cli/saydo.js checkout --json > result.json

import { SCENARIOS, getScenario, defaultLevers } from '../src/scenarios.js';
import { runCohort, compare, sensitivity, simulatePersona } from '../src/simulate.js';
import { generateCrowd, TRAITS, TRAIT_LABELS } from '../src/persona.js';
import { formatP } from '../src/stats.js';
import { reasonLabel } from '../src/reasons.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c('1');
const dim = c('2');
const green = c('32');
const red = c('31');
const cyan = c('36');
const yellow = c('33');

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const bar = (x, width = 28) => '█'.repeat(Math.round(x * width)).padEnd(width, '░');

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== '' ? n : raw;
}

function parseAssignments(list, scenario) {
  const out = {};
  for (const item of list) {
    for (const pair of item.split(',').filter(Boolean)) {
      const [key, value] = pair.split('=');
      if (!scenario.levers.some((l) => l.key === key)) {
        throw new Error(`Unknown lever "${key}" for ${scenario.id}. Levers: ${scenario.levers.map((l) => l.key).join(', ')}`);
      }
      out[key] = parseValue(value);
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = { scenario: 'checkout', n: 2000, seed: 42, set: [], compare: null, sensitivity: false, json: false, persona: null };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--n') args.n = Number(rest.shift());
    else if (a === '--seed') args.seed = Number(rest.shift());
    else if (a === '--set') args.set.push(rest.shift());
    else if (a === '--compare') args.compare = rest.shift();
    else if (a === '--sensitivity') args.sensitivity = true;
    else if (a === '--json') args.json = true;
    else if (a === '--persona') args.persona = Number(rest.shift());
    else if (a === '--list') args.list = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!a.startsWith('-')) args.scenario = a;
    else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

const HELP = `
${bold('SayDo Lab')}: simulate what people say vs. what they do.

Usage: node cli/saydo.js [scenario] [options]

Scenarios: ${SCENARIOS.map((s) => `${s.id} (${s.sector})`).join(', ')}

Options:
  --n <int>            crowd size (default 2000)
  --seed <int>         random seed (default 42)
  --set k=v[,k=v]      override levers for the base variant (repeatable)
  --compare k=v[,k=v]  run a paired A/B test against the base variant
  --sensitivity        rank levers by how much they move conversion
  --persona <id>       print one persona's think-aloud journey
  --list               list the scenario's levers
  --json               machine-readable output
`;

function printCohort(scenario, r, title) {
  console.log(`\n${bold(title)}  ${dim(`n=${r.n}, seed=${r.seed}`)}`);
  console.log(`  Said they'd buy   ${cyan(pct(r.statedRate).padStart(6))}`);
  console.log(`  Actually did      ${green(pct(r.conversionRate).padStart(6))}  ${dim(`95% CI ${pct(r.conversionCI.low)} – ${pct(r.conversionCI.high)}`)}`);
  console.log(`  Say-do gap        ${red(pct(r.sayDoGap).padStart(6))}  ${dim('of "yes" answers never converted')}`);

  console.log(`\n  ${bold('Funnel')}`);
  for (const step of r.funnel) {
    console.log(`  ${step.label.padEnd(22)} ${bar(step.rate)} ${pct(step.rate).padStart(6)}`);
  }

  console.log(`\n  ${bold('Why they left')}`);
  for (const reason of r.reasons.slice(0, 6)) {
    console.log(`  ${reason.label.padEnd(34)} ${yellow(pct(reason.share, 0).padStart(4))}`);
  }

  console.log(`\n  ${bold('By segment')}${dim('                said    did    gap')}`);
  for (const s of r.segments) {
    console.log(`  ${s.label.padEnd(24)} ${pct(s.statedRate, 0).padStart(6)} ${pct(s.conversionRate, 0).padStart(6)} ${pct(s.sayDoGap, 0).padStart(6)}`);
  }
}

function printPersona(scenario, levers, id, args) {
  const crowd = generateCrowd(scenario, Math.max(args.n, id + 1), args.seed);
  const p = crowd[id];
  const seg = scenario.segments.find((s) => s.id === p.segment);
  const j = simulatePersona(scenario, p, levers, args.seed, { trace: true });
  console.log(`\n${bold(`${p.name}, ${p.age}`)}  ${dim(`${seg.label} · ${p.mobile ? 'mobile' : 'desktop'} · would pay up to ${scenario.currency}${p.wtp.toFixed(0)}`)}`);
  for (const t of TRAITS) console.log(`  ${TRAIT_LABELS[t].padEnd(22)} ${bar(p.traits[t], 20)}`);
  console.log(`\n  ${dim('Survey:')} "${scenario.surveyQuestion(levers)}"  ${j.said ? green('Yes') : red('No')}`);
  for (const s of j.steps) {
    const mark = s.passed ? green('✔') : red('✘');
    console.log(`  ${mark} ${s.label.padEnd(22)} ${dim(pct(s.prob, 0).padStart(4))}  “${s.thought}”`);
  }
  console.log(`  ${j.converted ? green('→ Converted') : red(`→ Left: ${reasonLabel(j.reason)}`)}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);

  const scenario = getScenario(args.scenario);
  const levers = { ...defaultLevers(scenario), ...parseAssignments(args.set, scenario) };

  if (args.list) {
    console.log(`\n${bold(scenario.name)} levers:`);
    for (const l of scenario.levers) {
      const range = l.type === 'range' ? `${l.min}..${l.max}` : l.type === 'toggle' ? 'true|false' : l.options.map((o) => o.value).join('|');
      console.log(`  ${l.key.padEnd(18)} ${String(levers[l.key]).padEnd(10)} ${dim(range)}  ${l.label}`);
    }
    return;
  }

  if (args.persona !== null) return printPersona(scenario, levers, args.persona, args);

  const strip = ({ crowd, journeys, ...rest }) => rest;

  if (args.compare) {
    const leversB = { ...levers, ...parseAssignments([args.compare], scenario) };
    const res = compare(scenario, levers, leversB, { n: args.n, seed: args.seed });
    if (args.json) return console.log(JSON.stringify({ a: strip(res.a), b: strip(res.b), test: res.test, lift: res.lift }, null, 2));
    printCohort(scenario, res.a, `${scenario.name}: variant A`);
    printCohort(scenario, res.b, `${scenario.name}: variant B (${args.compare})`);
    const sign = res.lift >= 0 ? '+' : '';
    const color = res.lift >= 0 ? green : red;
    console.log(`\n${bold('Paired A/B result')}  ${dim('(same personas saw both variants)')}`);
    console.log(`  Conversion ${pct(res.a.conversionRate)} → ${pct(res.b.conversionRate)}  ${color(`${sign}${(res.lift * 100).toFixed(1)} pts`)}  ${dim(formatP(res.test.p) + ', McNemar')}`);
    console.log(`  ${res.switchedOn} personas converted only with B, ${res.switchedOff} only with A.`);
    return;
  }

  if (args.sensitivity) {
    const s = sensitivity(scenario, levers, { n: args.n, seed: args.seed });
    if (args.json) return console.log(JSON.stringify(s, null, 2));
    console.log(`\n${bold('What moves the needle?')}  ${dim(`base conversion ${pct(s.base)}`)}`);
    for (const row of s.rows) {
      console.log(`  ${row.label.padEnd(26)} ${red(pct(row.worst.rate).padStart(6))} @ ${String(row.worst.value).padEnd(9)} ${green(pct(row.best.rate).padStart(6))} @ ${String(row.best.value).padEnd(9)} ${dim(`span ${(row.span * 100).toFixed(1)} pts`)}`);
    }
    return;
  }

  const r = runCohort(scenario, levers, { n: args.n, seed: args.seed });
  if (args.json) return console.log(JSON.stringify(strip(r), null, 2));
  printCohort(scenario, r, scenario.name);
}

try {
  main();
} catch (err) {
  console.error(red(err.message));
  process.exit(1);
}
