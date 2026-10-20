import { SCENARIOS, getScenario, defaultLevers } from '../src/scenarios.js';
import { runCohort, compare, sensitivity, simulatePersona } from '../src/simulate.js';
import { TRAITS, TRAIT_LABELS } from '../src/persona.js';
import { formatP } from '../src/stats.js';
import { reasonLabel } from '../src/reasons.js';
import { drawFlow } from './flow.js?v=2';

// muted print colours, one per segment
const SEGMENT_COLORS = ['#c4901d', '#2f6f73', '#7d3c6b', '#707c2a', '#4a5a8a'];

const $ = (sel) => document.querySelector(sel);
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const state = {
  scenario: SCENARIOS[0],
  compareMode: false,
  editing: 'A',
  levers: { A: defaultLevers(SCENARIOS[0]), B: defaultLevers(SCENARIOS[0]) },
  n: 2000,
  seed: 42,
  result: null, // { a, b?, test? }
  sens: null,
  sampleOffset: 0,
  inspect: null,
};

function formatLever(lever, value) {
  if (lever.type === 'toggle') return value ? 'on' : 'off';
  if (lever.type === 'select') return lever.options.find((o) => o.value === value)?.label ?? value;
  if (lever.unit === '$') return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
  if (lever.unit === '%') return pct(value);
  if (lever.unit === 's') return `${value.toFixed(1)}s`;
  return String(value);
}

function segmentColors() {
  return Object.fromEntries(state.scenario.segments.map((s, i) => [s.id, SEGMENT_COLORS[i % SEGMENT_COLORS.length]]));
}

// ------------------------------------------------------------------ setup panel

function renderScenarioList() {
  $('#scenario-list').innerHTML = SCENARIOS.map(
    (s) => `<button class="scenario-opt ${s.id === state.scenario.id ? 'active' : ''}" data-id="${s.id}"
      role="radio" aria-checked="${s.id === state.scenario.id}">
      <span class="name">${esc(s.name)}</span><span class="sector">${esc(s.sector)}</span>
    </button>`,
  ).join('');
  $('#scenario-blurb').textContent = state.scenario.blurb;
}

function renderLevers() {
  const v = state.editing;
  const L = state.levers[v];
  const other = state.levers[v === 'A' ? 'B' : 'A'];
  const box = $('#levers');
  box.className = `levers variant-${v}`;

  box.innerHTML = state.scenario.levers
    .map((lever) => {
      const changed = state.compareMode && v === 'B' && L[lever.key] !== other[lever.key];
      const cls = `lever ${changed ? 'changed' : ''}`;
      if (lever.type === 'range') {
        return `<div class="${cls}">
          <div class="lever-head"><span>${esc(lever.label)}</span><span class="val">${formatLever(lever, L[lever.key])}</span></div>
          <input type="range" data-key="${lever.key}" min="${lever.min}" max="${lever.max}" step="${lever.step}"
            value="${L[lever.key]}" aria-label="${esc(lever.label)}" />
        </div>`;
      }
      if (lever.type === 'toggle') {
        return `<div class="${cls}">
          <label class="check"><input type="checkbox" data-key="${lever.key}" ${L[lever.key] ? 'checked' : ''} />
            <span class="box"></span><span>${esc(lever.label)}</span></label>
        </div>`;
      }
      return `<div class="${cls}">
        <div class="lever-head"><span>${esc(lever.label)}</span></div>
        <div class="choice" role="group" aria-label="${esc(lever.label)}">
          ${lever.options
            .map((o) => `<button data-key="${lever.key}" data-value="${o.value}" class="${L[lever.key] === o.value ? 'active' : ''}">${esc(o.label)}</button>`)
            .join('')}
        </div>
      </div>`;
    })
    .join('');
}

function setLever(key, value) {
  state.levers[state.editing][key] = value;
  renderLevers();
  scheduleRun();
}

// ------------------------------------------------------------------ running

let runTimer = null;
let sensTimer = null;

function scheduleRun(delay = 140) {
  clearTimeout(runTimer);
  runTimer = setTimeout(run, delay);
}

function run() {
  const { scenario, n, seed } = state;
  state.result = state.compareMode
    ? compare(scenario, state.levers.A, state.levers.B, { n, seed })
    : { a: runCohort(scenario, state.levers.A, { n, seed }) };
  if (state.inspect === null || state.inspect >= n) state.inspect = pickSample()[0];

  renderLede();
  renderScoreboard();
  renderLegend();
  renderFlow();
  renderFunnel();
  renderMatrix();
  renderReasons();
  renderSegments();
  renderCaseIndex();
  renderCaseFile();

  clearTimeout(sensTimer);
  sensTimer = setTimeout(() => {
    state.sens = sensitivity(scenario, state.levers.A, { n: Math.min(n, 1200), seed });
    renderSensitivity();
  }, 60);
}

// ------------------------------------------------------------------ report

function renderLede() {
  const { a, b, test } = state.result;
  const num = (x, d = 0) => `<span class="n">${pct(x, d)}</span>`;

  if (!b) {
    const top = a.reasons[0];
    $('#lede').innerHTML = `Of ${a.n.toLocaleString()} people, ${num(a.statedRate)} told us they would.
      ${num(a.conversionRate)} actually did. <span class="hl">${num(a.sayDoGap)} of the people who said yes
      never followed through.</span>${top ? ` The most common reason anyone left: ${esc(top.label.toLowerCase())}.` : ''}
      <small>Change a lever on the left and everything re-runs. Tick <em>compare A / B</em> to try a fix on the very same people.</small>`;
    return;
  }

  const lift = b.conversionRate - a.conversionRate;
  const sig = test.p < 0.05;
  const verb = lift >= 0 ? 'converts' : 'only converts';
  $('#lede').innerHTML = `Variant <span class="b">B</span> ${verb} ${num(b.conversionRate, 1)} against A's
    ${num(a.conversionRate, 1)}, ${lift >= 0 ? 'a gain' : 'a loss'} of ${Math.abs(lift * 100).toFixed(1)} points.
    ${sig ? 'That is not noise.' : 'That could easily be noise.'}
    <small>Same ${a.n.toLocaleString()} people, same dice. ${state.result.switchedOn} of them bought only under B,
    ${state.result.switchedOff} only under A (McNemar, ${formatP(test.p)}). The say-do gap goes from
    ${pct(a.sayDoGap)} to ${pct(b.sayDoGap)}.</small>`;
}

function score(cls, k, valA, valB, fmt, sub, higherIsBetter = true) {
  let v = fmt(valA);
  let s = sub;
  if (valB !== undefined) {
    const d = valB - valA;
    const good = higherIsBetter ? d >= 0 : d <= 0;
    v = `${fmt(valA)}<span class="arrow">→</span><span class="b">${fmt(valB)}</span>`;
    s = `<span class="${good ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts</span>, ${sub}`;
  }
  return `<div class="score ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
}

function renderScoreboard() {
  const { a, b } = state.result;
  const ci = a.conversionCI;
  const leak = biggestLeak(a);
  $('#scoreboard').classList.toggle('vs', Boolean(b));
  $('#scoreboard').innerHTML = [
    score('', 'Said yes', a.statedRate, b?.statedRate, (x) => pct(x), 'in the survey'),
    score('', 'Did it', a.conversionRate, b?.conversionRate, (x) => pct(x), `95% CI ${pct(ci.low, 1)} to ${pct(ci.high, 1)}`),
    score('gap', 'Say-do gap', a.sayDoGap, b?.sayDoGap, (x) => pct(x), 'of yes-sayers walked', false),
    `<div class="score"><div class="k">Leakiest step</div><div class="v word">${esc(leak.label)}</div>
      <div class="s">${pct(leak.loss)} of arrivals give up here</div></div>`,
  ].join('');
}

function biggestLeak(r) {
  let best = { label: '', loss: 0 };
  for (let i = 0; i < r.funnel.length - 1; i++) {
    const here = r.funnel[i].count;
    const loss = here ? 1 - r.funnel[i + 1].count / here : 0;
    if (loss > best.loss) best = { label: r.funnel[i].label, loss };
  }
  return best;
}

function renderLegend() {
  const colors = segmentColors();
  $('#segment-legend').innerHTML = state.scenario.segments
    .map((s) => `<span><i style="background:${colors[s.id]}"></i>${esc(s.label)}</span>`)
    .join('');
}

function renderFlow() {
  const { a, b } = state.result;
  const lanes = [{ name: 'A', color: cssVar('--ink'), result: a }];
  if (b) lanes.push({ name: 'B', color: cssVar('--blue'), result: b });
  drawFlow($('#flow'), { scenario: state.scenario, lanes, colors: segmentColors() });
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function bar(cls, width, label) {
  return `<div class="bar ${cls}"><div class="track"><div class="fill" style="width:${(width * 100).toFixed(2)}%"></div></div><span class="num">${label}</span></div>`;
}

function renderFunnel() {
  const { a, b } = state.result;
  $('#funnel').innerHTML = a.funnel
    .map(
      (step, i) => `<div class="bar-row">
        <div class="name">${esc(step.label)}</div>
        <div class="bars">
          ${bar('a', step.rate, pct(step.rate, 1))}
          ${b ? bar('b', b.funnel[i].rate, pct(b.funnel[i].rate, 1)) : ''}
        </div>
      </div>`,
    )
    .join('');
}

function matrixTable(r, title) {
  const m = r.matrix;
  const cell = (cls, v, what) => `<td class="${cls}"><span class="pct">${pct(v / r.n)}</span><span class="what">${what}</span></td>`;
  return `<table class="matrix">
    ${title ? `<caption>${title}</caption>` : ''}
    <tr><th></th><th>bought</th><th>didn't</th></tr>
    <tr><th scope="row">said yes</th>${cell('', m.yesBought, 'kept their word')}${cell('gapcell', m.yesLeft, 'the gap')}</tr>
    <tr><th scope="row">said no</th>${cell('', m.noBought, 'bought anyway')}${cell('', m.noLeft, 'meant it')}</tr>
  </table>`;
}

function renderMatrix() {
  const { a, b } = state.result;
  const m = a.matrix;
  $('#matrix').innerHTML = b
    ? `<div class="matrices two">${matrixTable(a, 'A')}${matrixTable(b, '<span style="color:var(--blue)">B</span>')}</div>`
    : `<div class="matrices">${matrixTable(a)}</div>`;
  $('#matrix-caption').innerHTML = `<b>Fig. 3</b> ${pct(m.yesLeft / a.n)} of the whole crowd promised and walked away.
    A survey would have counted them as customers. ${pct(m.noBought / a.n)} said no and bought anyway.`;
}

function renderReasons() {
  const { a, b } = state.result;
  const keys = [...new Set([...a.reasons.slice(0, 7).map((r) => r.key), ...(b ? b.reasons.slice(0, 7).map((r) => r.key) : [])])].slice(0, 8);
  const share = (r, key) => (r.reasons.find((x) => x.key === key)?.count ?? 0) / r.n;
  const max = Math.max(...keys.map((k) => Math.max(share(a, k), b ? share(b, k) : 0)), 0.0001);
  $('#reasons').innerHTML = keys
    .map(
      (k) => `<div class="bar-row">
        <div class="name">${esc(reasonLabel(k))}</div>
        <div class="bars">
          ${bar('r', share(a, k) / max, pct(share(a, k), 1))}
          ${b ? bar('r b', share(b, k) / max, pct(share(b, k), 1)) : ''}
        </div>
      </div>`,
    )
    .join('');
  $('#reasons-caption').innerHTML = `<b>Fig. 4</b> Share of the crowd lost to each reason${b ? ' (A hatched, B solid)' : ''}.
    The reason is whatever pushed hardest at the moment they left.`;
}

function renderSegments() {
  const { a, b } = state.result;
  const colors = segmentColors();
  const worst = a.segments.reduce((w, s) => (s.sayDoGap > w.sayDoGap ? s : w), a.segments[0]);
  const rows = a.segments
    .map((s, i) => {
      const sb = b?.segments[i];
      return `<tr>
        <td><span class="dot" style="background:${colors[s.id]}"></span>${esc(s.label)}</td>
        <td>${pct(s.statedRate)}</td>
        <td>${pct(s.conversionRate)}</td>
        <td class="${s.id === worst.id ? 'worst' : ''}">${pct(s.sayDoGap)}</td>
        ${sb ? `<td class="${sb.conversionRate >= s.conversionRate ? 'up' : 'down'}">${pct(sb.conversionRate)}</td>` : ''}
      </tr>`;
    })
    .join('');
  $('#segments').innerHTML = `<table class="plain">
    <thead><tr><th>Segment</th><th>Said</th><th>Did</th><th>Gap</th>${b ? '<th>Did (B)</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderSensitivity() {
  if (!state.sens) return;
  const { base, rows } = state.sens;
  const maxDelta = Math.max(...rows.map((r) => Math.max(Math.abs(r.best.rate - base), Math.abs(r.worst.rate - base))), 0.001);
  const pos = (rate) => 50 + ((rate - base) / maxDelta) * 44;

  $('#sensitivity').innerHTML = `<div class="sens">${rows
    .map((r) => {
      const lever = state.scenario.levers.find((l) => l.key === r.key);
      const negW = Math.max(0, 50 - pos(r.worst.rate));
      const posW = Math.max(0, pos(r.best.rate) - 50);
      return `<div class="sens-row" data-key="${r.key}" data-best="${encodeURIComponent(JSON.stringify(r.best.value))}">
        <div>${esc(r.label)}<span class="now">now ${formatLever(lever, r.current)}</span></div>
        <div class="sens-track">
          <div class="neg" style="left:${50 - negW}%;width:${negW}%"></div>
          <div class="pos" style="left:50%;width:${posW}%"></div>
          <div class="zero"></div>
          ${negW > 1 ? `<span class="end" style="right:${50 + negW + 1}%">${formatLever(lever, r.worst.value)}</span>` : ''}
        </div>
        <div class="sens-best">${formatLever(lever, r.best.value)} → ${pct(r.best.rate, 1)}<span class="try">try this as B</span></div>
      </div>`;
    })
    .join('')}</div>`;
  $('#sens-caption').innerHTML = `<b>Fig. 5</b> Each lever pushed to both extremes while everything else stays put.
    The vertical line is today's ${pct(base, 1)}. Hatched: how bad the worst setting gets. Solid: what the best one buys you.`;
}

// ------------------------------------------------------------------ case files

// A mix worth reading: people whose fate flipped between A and B first, then
// promise-breakers, promise-keepers and surprise buyers.
function pickSample() {
  const { a, b } = state.result;
  const buckets = { yesLeft: [], yesBought: [], noBought: [], noLeft: [], flipped: [] };
  a.journeys.forEach((j, i) => {
    buckets[j.said ? (j.converted ? 'yesBought' : 'yesLeft') : j.converted ? 'noBought' : 'noLeft'].push(i);
    if (b && b.journeys[i].converted !== j.converted) buckets.flipped.push(i);
  });
  const take = (arr, k) => {
    const out = [];
    for (let i = 0; i < k && arr.length; i++) out.push(arr[(state.sampleOffset * 7 + i * 13) % arr.length]);
    return out;
  };
  return [
    ...new Set([
      ...take(buckets.flipped, 3),
      ...take(buckets.yesLeft, 3),
      ...take(buckets.yesBought, 2),
      ...take(buckets.noBought, 1),
      ...take(buckets.noLeft, 1),
    ]),
  ].slice(0, 8);
}

function caseTag(i) {
  const { a, b } = state.result;
  const j = a.journeys[i];
  const jb = b?.journeys[i];
  if (jb && jb.converted !== j.converted) return jb.converted ? ['good', 'won over by B'] : ['bad', 'lost by B'];
  if (j.said && !j.converted) return ['bad', 'said yes, left'];
  if (j.said) return ['', 'kept their word'];
  return j.converted ? ['good', 'said no, bought'] : ['', 'said no, meant it'];
}

function renderCaseIndex() {
  const colors = segmentColors();
  const { a } = state.result;
  const sample = pickSample();
  if (!sample.includes(state.inspect)) state.inspect = sample[0];
  $('#persona-list').innerHTML = sample
    .map((i) => {
      const p = a.crowd[i];
      const seg = state.scenario.segments.find((s) => s.id === p.segment);
      const [cls, tag] = caseTag(i);
      return `<button class="case-row ${i === state.inspect ? 'active' : ''}" data-id="${i}">
        <span class="id">#${String(i).padStart(4, '0')}</span>
        <span><span class="dot" style="background:${colors[p.segment]}"></span>${esc(p.name)}, ${p.age}</span>
        <span class="seg">${esc(seg.label)}, ${p.mobile ? 'phone' : 'laptop'}</span>
        <span class="tag ${cls}">${tag}</span>
      </button>`;
    })
    .join('');
}

function journeyHtml(variant, levers) {
  const s = state.scenario;
  const p = state.result.a.crowd[state.inspect];
  const j = simulatePersona(s, p, levers, state.seed, { trace: true });

  const steps = j.steps
    .map((st, idx) => {
      const forces = [...st.forces]
        .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
        .slice(0, 4)
        .map((f) => `<span class="${f.value >= 0 ? 'p' : 'm'}">${f.value >= 0 ? '+' : '−'}${Math.abs(f.value).toFixed(2)}</span> ${esc(f.key.replace(/_/g, ' '))}`)
        .join(' · ');
      return `<li class="${st.passed ? '' : 'out'}">
        <span class="no">${String(idx + 1).padStart(2, '0')}</span>
        <div>
          <div class="where">${esc(st.label)}, ${pct(st.prob)} likely to go on</div>
          <div class="thought">“${esc(st.thought)}”</div>
          <div class="forces">${forces}</div>
        </div>
      </li>`;
    })
    .join('');

  return `<div>
    ${state.compareMode ? `<div class="journey-head ${variant}">In variant ${variant}</div>` : ''}
    <div class="asked">Asked: “${esc(s.surveyQuestion(levers))}”<br />Said: <span class="said">“${j.said ? 'Yes, definitely.' : 'Probably not.'}”</span></div>
    <ol class="steps">${steps}</ol>
    ${j.converted ? '<div class="verdict ok">→ bought</div>' : `<div class="verdict lost">→ left: ${esc(reasonLabel(j.reason).toLowerCase())}</div>`}
  </div>`;
}

function renderCaseFile() {
  const s = state.scenario;
  const p = state.result.a.crowd[state.inspect];
  if (!p) return;
  const seg = s.segments.find((x) => x.id === p.segment);
  const money = (x) => `${s.currency}${x >= 20 ? Math.round(x) : x.toFixed(2)}`;
  const blocks = (v) => {
    const k = Math.round(v * 10);
    return '■'.repeat(k) + '□'.repeat(10 - k);
  };
  const traits = TRAITS.map((t) => `<div><span>${TRAIT_LABELS[t].toLowerCase()}</span><span class="blocks">${blocks(p.traits[t])}</span></div>`).join('');
  const extra = p.flags.needsBag ? ', travelling with a checked bag' : '';

  $('#persona-detail').innerHTML = `
    <div class="who">
      <h4>${esc(p.name)}, ${p.age}</h4>
      <p class="meta">${esc(seg.label)}, on a ${p.mobile ? 'phone' : 'laptop'}${extra}.
        Would pay up to ${money(p.wtp)}. How much they actually need it: ${pct(p.motivation)}.</p>
      <div class="traits">${traits}</div>
    </div>
    <div class="journeys ${state.compareMode ? 'two' : ''}">
      ${journeyHtml('A', state.levers.A)}
      ${state.compareMode ? journeyHtml('B', state.levers.B) : ''}
    </div>`;
}

// ------------------------------------------------------------------ events

function selectScenario(id) {
  state.scenario = getScenario(id);
  state.levers = { A: defaultLevers(state.scenario), B: defaultLevers(state.scenario) };
  state.inspect = null;
  state.sens = null;
  renderScenarioList();
  renderLevers();
  run();
}

function setCompare(on) {
  state.compareMode = on;
  state.inspect = null;
  $('#compare-toggle').checked = on;
  $('#variant-tabs').hidden = !on;
  if (!on) state.editing = 'A';
  document.querySelectorAll('.variant-tab').forEach((el) => el.classList.toggle('active', el.dataset.variant === state.editing));
  renderLevers();
  run();
}

function setEditing(v) {
  state.editing = v;
  document.querySelectorAll('.variant-tab').forEach((el) => el.classList.toggle('active', el.dataset.variant === v));
  renderLevers();
}

function bind() {
  $('#scenario-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.scenario-opt');
    if (btn && btn.dataset.id !== state.scenario.id) selectScenario(btn.dataset.id);
  });

  const levers = $('#levers');
  levers.addEventListener('input', (e) => {
    const el = e.target;
    if (el.type !== 'range') return;
    const lever = state.scenario.levers.find((l) => l.key === el.dataset.key);
    const value = Number(el.value);
    state.levers[state.editing][el.dataset.key] = value;
    el.closest('.lever').querySelector('.val').textContent = formatLever(lever, value);
    scheduleRun(160);
  });
  levers.addEventListener('change', (e) => {
    const el = e.target;
    if (el.type === 'checkbox') setLever(el.dataset.key, el.checked);
    if (el.type === 'range') renderLevers();
  });
  levers.addEventListener('click', (e) => {
    const btn = e.target.closest('.choice button');
    if (btn) setLever(btn.dataset.key, btn.dataset.value);
  });

  $('#compare-toggle').addEventListener('change', (e) => setCompare(e.target.checked));
  $('#variant-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.variant-tab');
    if (btn) setEditing(btn.dataset.variant);
  });
  $('#copy-ab').addEventListener('click', () => {
    state.levers.B = { ...state.levers.A };
    setEditing('B');
    run();
  });

  $('#crowd-size').addEventListener('change', (e) => {
    state.n = Number(e.target.value);
    state.inspect = null;
    run();
  });
  $('#seed').addEventListener('change', (e) => {
    state.seed = Math.max(0, Math.floor(Number(e.target.value) || 0));
    state.inspect = null;
    run();
  });
  $('#run').addEventListener('click', run);
  $('#reset').addEventListener('click', () => selectScenario(state.scenario.id));

  $('#sensitivity').addEventListener('click', (e) => {
    const row = e.target.closest('.sens-row');
    if (!row) return;
    state.levers.B = { ...state.levers.A, [row.dataset.key]: JSON.parse(decodeURIComponent(row.dataset.best)) };
    state.editing = 'B';
    setCompare(true);
    $('#lede').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#persona-list').addEventListener('click', (e) => {
    const row = e.target.closest('.case-row');
    if (!row) return;
    state.inspect = Number(row.dataset.id);
    renderCaseIndex();
    renderCaseFile();
  });
  $('#shuffle').addEventListener('click', () => {
    state.sampleOffset++;
    state.inspect = pickSample()[0];
    renderCaseIndex();
    renderCaseFile();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.result && renderFlow(), 200);
  });
}

// deep links: #flight, #checkout&b.guestCheckout=true&b.formFields=6
function applyHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const first = [...params.keys()][0];
  if (first && SCENARIOS.some((s) => s.id === first)) {
    state.scenario = getScenario(first);
    state.levers = { A: defaultLevers(state.scenario), B: defaultLevers(state.scenario) };
  }
  const parse = (v) => (v === 'true' ? true : v === 'false' ? false : v !== '' && Number.isFinite(Number(v)) ? Number(v) : v);
  for (const [k, v] of params) {
    const [variant, key] = k.split('.');
    if ((variant === 'a' || variant === 'b') && key in state.levers.A) {
      state.levers[variant.toUpperCase()][key] = parse(v);
      if (variant === 'b') state.compareMode = true;
    }
  }
  if (state.compareMode) {
    $('#compare-toggle').checked = true;
    $('#variant-tabs').hidden = false;
  }
}

applyHash();
renderScenarioList();
renderLevers();
bind();
// wait for the web fonts so the canvas labels don't render in a fallback face
(document.fonts?.ready ?? Promise.resolve()).then(run);
