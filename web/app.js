import { SCENARIOS, getScenario, defaultLevers } from '../src/scenarios.js';
import { runCohort, compare, sensitivity, simulatePersona } from '../src/simulate.js';
import { TRAITS, TRAIT_LABELS } from '../src/persona.js';
import { formatP } from '../src/stats.js';
import { reasonLabel } from '../src/reasons.js';
import { drawFlow } from './flow.js';

const SEGMENT_COLORS = ['#7c6cff', '#22d3b6', '#ffb547', '#ff6b8b', '#4cc3ff'];

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

// ---------------------------------------------------------------- formatting

function formatLever(lever, value) {
  if (lever.type === 'toggle') return value ? 'On' : 'Off';
  if (lever.type === 'select') return lever.options.find((o) => o.value === value)?.label ?? value;
  if (lever.unit === '$') return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
  if (lever.unit === '%') return pct(value);
  if (lever.unit === 's') return `${value.toFixed(1)}s`;
  return String(value);
}

function segmentColors() {
  return Object.fromEntries(state.scenario.segments.map((s, i) => [s.id, SEGMENT_COLORS[i % SEGMENT_COLORS.length]]));
}

// ---------------------------------------------------------------- controls

function renderScenarioTabs() {
  $('#scenario-tabs').innerHTML = SCENARIOS.map(
    (s) => `
    <button class="scenario-tab ${s.id === state.scenario.id ? 'active' : ''}" data-id="${s.id}" role="tab"
      aria-selected="${s.id === state.scenario.id}">
      <strong>${esc(s.name)}</strong><span class="sector">${esc(s.sector)}</span>
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
          <input type="range" data-key="${lever.key}" min="${lever.min}" max="${lever.max}" step="${lever.step}" value="${L[lever.key]}"
            aria-label="${esc(lever.label)}" />
        </div>`;
      }
      if (lever.type === 'toggle') {
        return `<div class="${cls} toggle-lever">
          <div class="lever-head"><span>${esc(lever.label)}</span></div>
          <label class="switch"><input type="checkbox" data-key="${lever.key}" ${L[lever.key] ? 'checked' : ''}
            aria-label="${esc(lever.label)}" /><span class="track"><span class="thumb"></span></span></label>
        </div>`;
      }
      return `<div class="${cls}">
        <div class="lever-head"><span>${esc(lever.label)}</span></div>
        <div class="segmented" role="group" aria-label="${esc(lever.label)}">
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

// ---------------------------------------------------------------- running

let runTimer = null;
let sensTimer = null;

function scheduleRun(delay = 140) {
  clearTimeout(runTimer);
  runTimer = setTimeout(run, delay);
}

function run() {
  const { scenario, n, seed } = state;
  if (state.compareMode) {
    const res = compare(scenario, state.levers.A, state.levers.B, { n, seed });
    state.result = res;
  } else {
    state.result = { a: runCohort(scenario, state.levers.A, { n, seed }) };
  }
  if (state.inspect === null || state.inspect >= n) state.inspect = pickSample()[0];
  renderResults();

  clearTimeout(sensTimer);
  sensTimer = setTimeout(() => {
    state.sens = sensitivity(scenario, state.levers.A, { n: Math.min(n, 1200), seed });
    renderSensitivity();
  }, 60);
}

function renderResults() {
  renderInsight();
  renderKpis();
  renderLegend();
  renderFlow();
  renderFunnel();
  renderMatrix();
  renderReasons();
  renderSegments();
  renderPersonaList();
  renderPersonaDetail();
}

// ---------------------------------------------------------------- results

function renderInsight() {
  const { a, b, test } = state.result;
  const top = a.reasons[0];
  let html = `<b class="say">${pct(a.statedRate)}</b> said they would. <b class="do">${pct(a.conversionRate)}</b> actually did.
    <b class="gap">${pct(a.sayDoGap)}</b> of the "yes" answers never turned into action.`;
  if (top) html += ` The #1 reason people left: <b>${esc(top.label.toLowerCase())}</b> (${pct(top.share)} of drop-offs).`;

  if (b) {
    const up = b.conversionRate >= a.conversionRate;
    const sig = test.p < 0.05;
    html = `Variant B ${up ? 'lifts' : 'drops'} conversion from <b class="say">${pct(a.conversionRate, 1)}</b> to
      <b class="do">${pct(b.conversionRate, 1)}</b>
      (<b class="${up ? 'do' : 'gap'}">${up ? '+' : ''}${((b.conversionRate - a.conversionRate) * 100).toFixed(1)} pts</b>,
      ${sig ? 'statistically significant' : 'not significant'}).
      The say-do gap moves from <b class="gap">${pct(a.sayDoGap)}</b> to <b class="gap">${pct(b.sayDoGap)}</b>.
      <small>Paired test on the same ${a.n.toLocaleString()} personas: ${state.result.switchedOn} converted only with B,
      ${state.result.switchedOff} only with A. McNemar ${formatP(test.p)}.</small>`;
  } else {
    html += `<small>Simulated ${a.n.toLocaleString()} synthetic personas · seed ${a.seed}. Turn on <b>A/B test</b> to try a fix on the very same crowd.</small>`;
  }
  $('#insight').innerHTML = html;
}

function kpi(label, accent, valA, valB, fmt, sub, higherIsBetter = true) {
  let value = fmt(valA);
  let subline = sub;
  if (valB !== undefined) {
    const d = valB - valA;
    const good = higherIsBetter ? d >= 0 : d <= 0;
    value = `${fmt(valA)} <span class="vs">→</span> ${fmt(valB)}`;
    subline = `<span class="${good ? 'delta-pos' : 'delta-neg'}">${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts</span> · ${sub}`;
  }
  return `<div class="kpi" style="--accent:${accent}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${subline}</div></div>`;
}

function renderKpis() {
  const { a, b } = state.result;
  const ci = a.conversionCI;
  const topStage = biggestLeak(a);
  $('#kpis').innerHTML = [
    kpi('Said they would', 'var(--say)', a.statedRate, b?.statedRate, (x) => pct(x), 'stated intent in a survey'),
    kpi('Actually did', 'var(--do)', a.conversionRate, b?.conversionRate, (x) => pct(x, 1), `95% CI ${pct(ci.low, 1)}–${pct(ci.high, 1)}`),
    kpi('Say-do gap', 'var(--gap)', a.sayDoGap, b?.sayDoGap, (x) => pct(x), '"yes" answers that never converted', false),
    `<div class="kpi" style="--accent:var(--warn)"><div class="label">Biggest leak</div>
      <div class="value" style="font-size:19px;line-height:1.9">${esc(topStage.label)}</div>
      <div class="sub">loses ${pct(topStage.loss)} of those who reach it</div></div>`,
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
  const lanes = [{ name: 'A', color: getVar('--say'), result: a }];
  if (b) lanes.push({ name: 'B', color: getVar('--do'), result: b });
  drawFlow($('#flow'), { scenario: state.scenario, lanes, colors: segmentColors() });
}

function getVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function barHtml(cls, rate, label) {
  return `<div class="bar ${cls}"><span style="width:${(rate * 100).toFixed(2)}%"></span><em>${label}</em></div>`;
}

function renderFunnel() {
  const { a, b } = state.result;
  $('#funnel').innerHTML = a.funnel
    .map(
      (step, i) => `
      <div class="funnel-row">
        <div class="name" title="${esc(step.label)}">${esc(step.label)}</div>
        <div class="bars">
          ${barHtml('a', step.rate, pct(step.rate, 1))}
          ${b ? barHtml('b', b.funnel[i].rate, pct(b.funnel[i].rate, 1)) : ''}
        </div>
      </div>`,
    )
    .join('');
}

function matrixHtml(r, title) {
  const m = r.matrix;
  const cell = (cls, v, text) => `<div class="cell ${cls}"><b>${pct(v / r.n)}</b><span>${text}</span></div>`;
  return `<div>
    ${title ? `<div class="matrix-title">${title}</div>` : ''}
    <div class="matrix">
      <div></div><div class="axis">Did it</div><div class="axis">Didn't</div>
      <div class="axis">Said yes</div>${cell('good', m.yesBought, 'kept their word')}${cell('hot', m.yesLeft, 'the say-do gap')}
      <div class="axis">Said no</div>${cell('surprise', m.noBought, 'converted anyway')}${cell('', m.noLeft, 'consistent no')}
    </div>
  </div>`;
}

function renderMatrix() {
  const { a, b } = state.result;
  const m = a.matrix;
  const note = `${pct(m.yesLeft / a.n)} of the crowd promised and walked away. A survey would have counted them as customers.
    Meanwhile ${pct(m.noBought / a.n)} said no and bought anyway (impulse beats intention).`;
  $('#matrix').innerHTML = b
    ? `<div class="matrix-wrap two">${matrixHtml(a, 'Variant A')}${matrixHtml(b, 'Variant B')}</div>`
    : `<div class="matrix-wrap">${matrixHtml(a)}</div><p class="matrix-note">${note}</p>`;
}

function renderReasons() {
  const { a, b } = state.result;
  const keys = [...new Set([...a.reasons.slice(0, 7).map((r) => r.key), ...(b ? b.reasons.slice(0, 7).map((r) => r.key) : [])])].slice(0, 8);
  const ofCrowd = (r, key) => (r.reasons.find((x) => x.key === key)?.count ?? 0) / r.n;
  const max = Math.max(...keys.map((k) => Math.max(ofCrowd(a, k), b ? ofCrowd(b, k) : 0)), 0.0001);
  $('#reasons').innerHTML =
    keys
      .map((k) => {
        const va = ofCrowd(a, k);
        const vb = b ? ofCrowd(b, k) : 0;
        return `<div class="reason-row">
        <div>${esc(reasonLabel(k))}</div>
        <div class="bars">
          ${barHtml('warn', va / max, pct(va, 1))}
          ${b ? barHtml('b', vb / max, pct(vb, 1)) : ''}
        </div>
      </div>`;
      })
      .join('') + `<p class="matrix-note">Share of the whole crowd lost to each reason${b ? ' (top: A, bottom: B)' : ''}.</p>`;
}

function renderSegments() {
  const { a, b } = state.result;
  const colors = segmentColors();
  const rows = a.segments
    .map((s, i) => {
      const sb = b?.segments[i];
      return `<tr>
        <td><span class="dot" style="background:${colors[s.id]}"></span>${esc(s.label)}</td>
        <td>${pct(s.statedRate)}</td>
        <td>${pct(s.conversionRate)}</td>
        <td><span class="gap-pill" style="--g:${Math.round(s.sayDoGap * 60)}">${pct(s.sayDoGap)}</span></td>
        ${sb ? `<td class="${sb.conversionRate >= s.conversionRate ? 'delta-pos' : 'delta-neg'}">${pct(sb.conversionRate)}</td>` : ''}
      </tr>`;
    })
    .join('');
  $('#segments').innerHTML = `<table>
    <thead><tr><th>Segment</th><th>Said</th><th>Did</th><th>Gap</th>${b ? '<th>Did (B)</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderSensitivity() {
  if (!state.sens) return;
  const { base, rows } = state.sens;
  const maxDelta = Math.max(...rows.map((r) => Math.max(Math.abs(r.best.rate - base), Math.abs(r.worst.rate - base))), 0.001);
  const pos = (rate) => 50 + ((rate - base) / maxDelta) * 46;

  $('#sensitivity').innerHTML = `<div class="tornado">${rows
    .map((r) => {
      const lever = state.scenario.levers.find((l) => l.key === r.key);
      const wl = pos(r.worst.rate);
      const bl = pos(r.best.rate);
      const negW = Math.max(0, 50 - wl);
      const posW = Math.max(0, bl - 50);
      return `<div class="t-row" data-key="${r.key}" data-best="${encodeURIComponent(JSON.stringify(r.best.value))}" title="Try the best setting as Variant B">
        <div>${esc(r.label)} <span class="hint">· now ${formatLever(lever, r.current)}</span></div>
        <div class="t-track">
          <div class="t-bar neg" style="left:${50 - negW}%;width:${negW}%"></div>
          <div class="t-bar pos" style="left:50%;width:${posW}%"></div>
          <div class="axis-line"></div>
          ${negW > 0.5 ? `<span class="t-lbl" style="right:${100 - (50 - negW) + 1}%">${formatLever(lever, r.worst.value)}</span>` : ''}
        </div>
        <div class="t-best">best: <b>${formatLever(lever, r.best.value)}</b> → ${pct(r.best.rate, 1)}</div>
      </div>`;
    })
    .join('')}</div>
    <p class="matrix-note">Centre line = current conversion (${pct(base, 1)}). Red: how much worse the lever's worst setting gets you. Green: how much its best setting gains.</p>`;
}

// ---------------------------------------------------------------- personas

// Pick an interesting cross-section: promise-breakers, keepers, surprises.
function pickSample() {
  const { a } = state.result;
  const buckets = { yesLeft: [], yesBought: [], noBought: [], noLeft: [] };
  a.journeys.forEach((j, i) => {
    const key = j.said ? (j.converted ? 'yesBought' : 'yesLeft') : j.converted ? 'noBought' : 'noLeft';
    buckets[key].push(i);
  });
  const take = (arr, k) => {
    const out = [];
    for (let i = 0; i < k && arr.length; i++) out.push(arr[(state.sampleOffset * 7 + i * 13) % arr.length]);
    return out;
  };
  // In A/B mode lead with people whose fate flipped: same person, two worlds.
  const flipped = [];
  if (state.result.b) {
    a.journeys.forEach((j, i) => {
      if (j.converted !== state.result.b.journeys[i].converted) flipped.push(i);
    });
  }
  return [
    ...new Set([
      ...take(flipped, 3),
      ...take(buckets.yesLeft, 4),
      ...take(buckets.yesBought, 3),
      ...take(buckets.noBought, 2),
      ...take(buckets.noLeft, 2),
    ]),
  ].slice(0, 12);
}

function renderPersonaList() {
  const colors = segmentColors();
  const { a } = state.result;
  const sample = pickSample();
  if (!sample.includes(state.inspect)) state.inspect = sample[0];
  $('#persona-list').innerHTML = sample
    .map((i) => {
      const p = a.crowd[i];
      const j = a.journeys[i];
      const jb = state.result.b?.journeys[i];
      let tag = j.said ? (j.converted ? 'kept word' : 'said yes, left') : j.converted ? 'surprise buyer' : 'said no';
      if (jb && jb.converted !== j.converted) tag = jb.converted ? 'won by B' : 'lost by B';
      return `<button class="chip ${i === state.inspect ? 'active' : ''}" data-id="${i}">
        <span class="avatar" style="background:${colors[p.segment]}">${esc(p.name[0])}</span>
        ${esc(p.name)}, ${p.age} <span class="tag">${tag}</span>
      </button>`;
    })
    .join('');
}

function journeyHtml(variant, levers) {
  const s = state.scenario;
  const { a } = state.result;
  const p = a.crowd[state.inspect];
  const j = simulatePersona(s, p, levers, state.seed, { trace: true });
  const steps = j.steps
    .map((st) => {
      const forces = [...st.forces]
        .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
        .slice(0, 4)
        .map((f) => `<span class="force ${f.value >= 0 ? 'pos' : 'neg'}">${f.value >= 0 ? '+' : '−'}${Math.abs(f.value).toFixed(2)} ${esc(f.key)}</span>`)
        .join('');
      return `<li class="${st.passed ? 'pass' : 'fail'}">
        <span class="mark">${st.passed ? '✓' : '✕'}</span>
        <div class="step-head"><span>${esc(st.label)}</span><span>${pct(st.prob)} chance to continue</span></div>
        <div class="thought">“${esc(st.thought)}”</div>
        <div class="forces">${forces}</div>
      </li>`;
    })
    .join('');
  const outcome = j.converted
    ? `<div class="outcome ok">Converted</div>`
    : `<div class="outcome lost">Left: ${esc(reasonLabel(j.reason))}</div>`;
  return `<div>
    ${state.compareMode ? `<div class="journey-title ${variant}">Variant ${variant}</div>` : ''}
    <div class="survey-quote">Survey: “${esc(s.surveyQuestion(levers))}” → <span class="${j.said ? 'ans-yes' : 'ans-no'}">${j.said ? 'Yes, definitely.' : 'Probably not.'}</span></div>
    <ol class="timeline">${steps}</ol>
    ${outcome}
  </div>`;
}

function renderPersonaDetail() {
  const s = state.scenario;
  const { a } = state.result;
  const p = a.crowd[state.inspect];
  if (!p) return;
  const seg = s.segments.find((x) => x.id === p.segment);
  const traits = TRAITS.map(
    (t) => `<div class="trait"><span>${TRAIT_LABELS[t]}</span><div class="bar"><span style="width:${(p.traits[t] * 100).toFixed(0)}%"></span></div></div>`,
  ).join('');
  const money = (x) => `${s.currency}${x >= 20 ? Math.round(x) : x.toFixed(2)}`;
  const flags = Object.entries(p.flags)
    .filter(([, v]) => v)
    .map(([k]) => (k === 'needsBag' ? 'needs a checked bag' : k));

  $('#persona-detail').innerHTML = `
    <div class="p-card">
      <h4>${esc(p.name)}, ${p.age}</h4>
      <div class="p-meta">${esc(seg.label)} · ${p.mobile ? 'on mobile' : 'on desktop'} · would pay up to ${money(p.wtp)}
        ${flags.length ? ` · ${flags.join(', ')}` : ''} · real need ${pct(p.motivation)}</div>
      ${traits}
    </div>
    <div class="journeys ${state.compareMode ? 'two' : ''}">
      ${journeyHtml('A', state.levers.A)}
      ${state.compareMode ? journeyHtml('B', state.levers.B) : ''}
    </div>`;
}

// ---------------------------------------------------------------- events

function selectScenario(id) {
  state.scenario = getScenario(id);
  state.levers = { A: defaultLevers(state.scenario), B: defaultLevers(state.scenario) };
  state.inspect = null;
  state.sens = null;
  renderScenarioTabs();
  renderLevers();
  run();
}

function setCompare(on) {
  state.compareMode = on;
  state.inspect = null;
  $('#compare-toggle').checked = on;
  $('#variant-tabs').hidden = !on;
  if (!on) state.editing = 'A';
  document.querySelectorAll('.variant-tab').forEach((b) => b.classList.toggle('active', b.dataset.variant === state.editing));
  renderLevers();
  run();
}

function setEditing(v) {
  state.editing = v;
  document.querySelectorAll('.variant-tab').forEach((b) => b.classList.toggle('active', b.dataset.variant === v));
  renderLevers();
}

function bind() {
  $('#scenario-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.scenario-tab');
    if (btn && btn.dataset.id !== state.scenario.id) selectScenario(btn.dataset.id);
  });

  const levers = $('#levers');
  levers.addEventListener('input', (e) => {
    const el = e.target;
    if (el.type === 'range') {
      const lever = state.scenario.levers.find((l) => l.key === el.dataset.key);
      const value = Number(el.value);
      state.levers[state.editing][el.dataset.key] = value;
      el.closest('.lever').querySelector('.val').textContent = formatLever(lever, value);
      scheduleRun(160);
    }
  });
  levers.addEventListener('change', (e) => {
    const el = e.target;
    if (el.type === 'checkbox') setLever(el.dataset.key, el.checked);
    if (el.type === 'range') renderLevers();
  });
  levers.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented button');
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
    const row = e.target.closest('.t-row');
    if (!row) return;
    const value = JSON.parse(decodeURIComponent(row.dataset.best));
    state.levers.B = { ...state.levers.A, [row.dataset.key]: value };
    state.editing = 'B';
    setCompare(true);
    $('#insight').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#persona-list').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.inspect = Number(chip.dataset.id);
    renderPersonaList();
    renderPersonaDetail();
  });
  $('#shuffle').addEventListener('click', () => {
    state.sampleOffset++;
    state.inspect = pickSample()[0];
    renderPersonaList();
    renderPersonaDetail();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.result && renderFlow(), 200);
  });
}

// Deep links, e.g. #flight or #checkout&b.guestCheckout=true&b.formFields=6
function applyHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const first = [...params.keys()][0];
  if (first && SCENARIOS.some((s) => s.id === first)) {
    state.scenario = getScenario(first);
    state.levers = { A: defaultLevers(state.scenario), B: defaultLevers(state.scenario) };
  }
  const parse = (v) => (v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) && v !== '' ? Number(v) : v);
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
renderScenarioTabs();
renderLevers();
bind();
run();
