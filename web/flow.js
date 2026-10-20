// Animated crowd: each dot is one synthetic persona walking the funnel.
// Dots that drop out sink into a pile under the stage where they left;
// converters collect on the right. In A/B mode the same people walk two lanes.

const MAX_DOTS = 420;
const PILE_GAP = 5.4;
const SPAWN_MS = 9;

let raf = null;

// Cheap deterministic pseudo-random in [0, 1) so the layout is stable between runs.
const hash01 = (i) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function drawFlow(canvas, { scenario, lanes, colors }) {
  if (raf) cancelAnimationFrame(raf);

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const laneH = lanes.length > 1 ? 150 : 230;
  const top = 34;
  const height = top + laneH * lanes.length + 10;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const stages = scenario.stages;
  const left = 56;
  const right = width - 90;
  const gateX = stages.map((_, i) => left + ((right - left) * (i + 0.5)) / stages.length);
  const endX = right + 40;

  const ink = cssVar('--ink');
  const soft = cssVar('--ink-soft');
  const rule = cssVar('--rule');
  const red = cssVar('--red');
  const mono = (size, weight = 400) => `${weight} ${size}px 'IBM Plex Mono', ui-monospace, monospace`;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = width < 560;

  const dots = [];
  lanes.forEach((lane, li) => {
    const y0 = top + laneH * li;
    const walkMid = y0 + (laneH - 40) / 2;
    const pileBottom = y0 + laneH - 26;
    const count = Math.min(MAX_DOTS, lane.result.journeys.length);
    // Dropouts and converters stack into tidy piles, so pile height = volume.
    const slots = new Array(stages.length + 1).fill(0);
    const cols = narrow ? 5 : lanes.length > 1 ? 12 : 9;
    const slot = (k) => {
      const n = slots[k]++;
      return { col: (n % cols) - (cols - 1) / 2, row: Math.floor(n / cols) };
    };
    for (let i = 0; i < count; i++) {
      const j = lane.result.journeys[i];
      const persona = lane.result.crowd[i];
      const jitter = hash01(i * 2 + li * 9973) - 0.5;
      const jitter2 = hash01(i * 2 + 1 + li * 9973) - 0.5;
      const k = j.converted ? stages.length : j.exitStage;
      const { col, row } = slot(k);
      dots.push({
        lane: li,
        color: colors[persona.segment],
        start: i * SPAWN_MS,
        speed: 0.2 + 0.08 * jitter2,
        y: walkMid + jitter * (laneH - 70),
        stopX: j.converted ? endX - 40 : gateX[j.exitStage],
        pileX: (j.converted ? endX : gateX[k]) + col * PILE_GAP,
        pileY: pileBottom - row * PILE_GAP,
        converted: j.converted,
        x: 0,
      });
    }
  });

  const t0 = performance.now();
  const totalMs = dots.reduce((m, d) => Math.max(m, d.start), 0) + (endX + 120) / 0.12;

  function frame(now) {
    const t = reduced ? totalMs : now - t0;
    ctx.clearRect(0, 0, width, height);

    // lanes & gates
    lanes.forEach((lane, li) => {
      const y0 = top + laneH * li;
      if (lanes.length > 1) {
        ctx.fillStyle = lane.color;
        ctx.font = "italic 500 26px 'Newsreader', Georgia, serif";
        ctx.fillText(lane.name, 8, y0 + laneH / 2 + 8);
        if (li > 0) {
          ctx.strokeStyle = rule;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.moveTo(0, y0);
          ctx.lineTo(width, y0);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      stages.forEach((s, si) => {
        const rate = lane.result.funnel[si + 1].rate;
        const lost = lane.result.funnel[si].rate - rate;
        ctx.fillStyle = soft;
        ctx.font = mono(11);
        ctx.textAlign = 'center';
        ctx.fillText(`−${Math.round(lost * 100)}%`, gateX[si], y0 + laneH - 8);
      });
      ctx.textAlign = 'left';
    });

    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    stages.forEach((s, si) => {
      ctx.beginPath();
      ctx.moveTo(gateX[si] + 0.5, top - 6);
      ctx.lineTo(gateX[si] + 0.5, height - 22);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.font = mono(11, 500);
    stages.forEach((s, si) => {
      ctx.fillStyle = ink;
      const label = narrow ? `${si + 1}` : s.label.toLowerCase();
      ctx.fillText(label, gateX[si], 18);
    });
    ctx.fillStyle = red;
    ctx.fillText(narrow ? 'done' : 'bought', endX, 18);
    ctx.textAlign = 'left';

    // dots
    for (const d of dots) {
      const age = t - d.start;
      if (age < 0) continue;
      d.x = Math.min(d.stopX, left - 30 + age * d.speed);
      let y = d.y;
      let alpha = 0.9;
      let x = d.x;
      if (d.x >= d.stopX) {
        const arrived = d.start + (d.stopX - (left - 30)) / d.speed;
        const fall = Math.min(1, (t - arrived) / 700);
        const ease = fall * fall;
        x = d.stopX + (d.pileX - d.stopX) * fall;
        y = d.y + (d.pileY - d.y) * ease;
        alpha = d.converted ? 1 : 0.9 - 0.5 * fall;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(x, y, d.converted && d.x >= d.stopX ? 3.2 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (t < totalMs) raf = requestAnimationFrame(frame);
    else raf = null;
  }

  raf = requestAnimationFrame(frame);
}
